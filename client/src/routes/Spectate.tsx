import { useEffect, useMemo, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { useFriendsStore } from '../store/friendsStore.ts'
import { useSpectateStore } from '../store/spectateStore.ts'
import { useGridSize } from '../hooks/useGridSize'
import type { GeneratedLevel } from '../lib/levelGen'
import { decodeShareCode } from '../lib/levelGen'
import { runLevelGeneration } from '../lib/levelGenCoordinator'
import type { CellState } from '../store/gameStore.ts'
import { CatMark } from '../components/CatMark'
import { CatReveal } from '../components/CatReveal'
import { XMark } from '../components/XMark'
import { QuestionMark } from '../components/QuestionMark'

const GRID_PAD = 8
const GRID_GAP = 3

// Matches CoopGame.tsx's COOP_PUZZLE_INDEX — both participants (and now a
// spectator) must derive the identical regions/colors/solution from the
// session's own (difficulty, puzzleSeed), so this stays a fixed constant
// rather than anything session- or client-specific.
const COOP_PUZZLE_INDEX = 1

const displayName = (p?: { name: string | null; is_anon: number } | null) =>
  p ? (p.name || (p.is_anon ? 'Guest' : 'Player')) : 'Your friend'

function CenteredScreen({ children }: { children: React.ReactNode }) {
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

export default function Spectate() {
  const { userId } = useParams<{ userId: string }>()
  const navigate = useNavigate()
  const friend = useFriendsStore(s => s.friends.find(f => f.id === userId))
  const { info, status, error, soloBoard, coopSession, matchPlayers, matchStats, start, stop } = useSpectateStore()

  useEffect(() => {
    if (!userId) return
    start(userId)
    return () => stop()
    // start/stop are stable store actions; only the target should re-trigger this.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [userId])

  const [level, setLevel] = useState<GeneratedLevel | null>(null)
  useEffect(() => {
    // Solo ships the finished puzzle itself (see spectateStore's
    // SpectateGameInfo) — decode it directly instead of regenerating,
    // which is instant and works for every solo mode, share links included.
    if (info?.mode === 'solo') {
      setLevel(info.puzzleCode ? decodeShareCode(info.puzzleCode) : null)
      return
    }
    setLevel(null)
    if (info?.mode === 'coop' && coopSession) {
      return runLevelGeneration(
        { type: 'generateLevelByDifficulty', difficulty: coopSession.difficulty, puzzleIndex: COOP_PUZZLE_INDEX, globalSeed: coopSession.puzzleSeed },
        () => {},
        (lvl) => setLevel(lvl),
        { maxWorkers: 1 },
      )
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [info?.mode, info?.puzzleCode, coopSession?.puzzleSeed, coopSession?.difficulty])

  const { wrapperRef, gridRef, gridSize } = useGridSize()

  const sparseBoard = info?.mode === 'coop' ? coopSession?.boardState : soloBoard
  const board = useMemo<CellState[][]>(() => {
    if (!level) return []
    const b = Array.from({ length: level.size }, () => Array<CellState>(level.size).fill('empty'))
    if (sparseBoard) {
      for (const [key, state] of Object.entries(sparseBoard)) {
        const [r, c] = key.split(',').map(Number)
        if (r < level.size && c < level.size) b[r][c] = state
      }
    }
    return b
  }, [level, sparseBoard])

  const solvedCount = useMemo(() => {
    if (!level) return 0
    let n = 0
    level.solution.forEach((cell) => { if (board[cell.r]?.[cell.c] === 'cat') n += 1 })
    return n
  }, [level, board])

  if (status === 'error') {
    return (
      <CenteredScreen>
        <span style={{ fontSize: 48 }}>🙀</span>
        <p style={{ color: '#7a2828', fontWeight: 700, fontSize: 17, margin: 0 }}>{error ?? 'Could not spectate'}</p>
        <BackButton onClick={() => navigate('/friends')} />
      </CenteredScreen>
    )
  }

  if (status !== 'active' || !info) {
    return (
      <CenteredScreen>
        <div style={{ width: 86, height: 86, display: 'flex', alignItems: 'center', justifyContent: 'center', animation: 'spin 1.2s linear infinite' }}><CatMark /></div>
        <p style={{ color: '#7a4545', fontWeight: 600, fontSize: 16, margin: 0 }}>Connecting…</p>
        <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
      </CenteredScreen>
    )
  }

  const friendName = displayName(friend)

  // Head-to-head boards aren't synced between opponents server-side (only
  // life/cat/x counters are), so there's nothing to mirror visually — a
  // read-only scoreboard is the honest version of "spectate" for this mode.
  if (info.mode === 'head_to_head') {
    return (
      <div className="phone-fullscreen" style={{
        backgroundColor: '#f0e8e0', fontFamily: 'system-ui, sans-serif',
        display: 'flex', flexDirection: 'column', alignItems: 'center', padding: '16px 12px', gap: 16,
      }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', width: '100%', maxWidth: 360 }}>
          <button onClick={() => navigate('/friends')} style={{ width: 42, height: 42, borderRadius: '50%', background: 'white', border: 'none', cursor: 'pointer', boxShadow: '0 1px 4px rgba(0,0,0,0.12)', fontSize: 18, color: '#7a4545' }}>←</button>
          <h1 style={{ fontSize: 18, fontWeight: 700, color: '#5a2828', margin: 0 }}>👁️ Spectating {friendName}</h1>
          <div style={{ width: 42 }} />
        </div>
        <div style={{ width: '100%', maxWidth: 360, display: 'flex', flexDirection: 'column', gap: 12 }}>
          {matchPlayers.map(player => {
            const stats = matchStats[player.id]
            return (
              <div key={player.id} style={{ background: 'white', borderRadius: 16, padding: 16, boxShadow: '0 2px 12px rgba(0,0,0,0.08)' }}>
                <div style={{ fontWeight: 700, color: '#5a2828', marginBottom: 8 }}>{displayName(player)}</div>
                {stats ? (
                  <div style={{ display: 'flex', gap: 16, fontSize: 14, color: '#7a5040' }}>
                    <span>🐟 {stats.fishCount}</span>
                    <span>🐱 {stats.catsFound}</span>
                    <span>✕ {stats.xPlaced}</span>
                  </div>
                ) : <span style={{ fontSize: 13, opacity: 0.6 }}>Loading…</span>}
              </div>
            )
          })}
        </div>
      </div>
    )
  }

  if (!level || board.length !== level.size) {
    return (
      <CenteredScreen>
        <div style={{ width: 86, height: 86, display: 'flex', alignItems: 'center', justifyContent: 'center', animation: 'spin 1.2s linear infinite' }}><CatMark /></div>
        <p style={{ color: '#7a4545', fontWeight: 600, fontSize: 16, margin: 0 }}>Generating puzzle…</p>
        <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
      </CenteredScreen>
    )
  }

  const SIZE = level.size

  return (
    <div className="phone-fullscreen" style={{
      backgroundColor: '#f0e8e0', fontFamily: 'system-ui, sans-serif',
      display: 'flex', flexDirection: 'column', overflow: 'hidden', padding: '0 12px', boxSizing: 'border-box',
    }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '10px 0', flexShrink: 0 }}>
        <button onClick={() => navigate('/friends')} style={{ width: 42, height: 42, borderRadius: '50%', background: 'white', border: 'none', cursor: 'pointer', boxShadow: '0 1px 4px rgba(0,0,0,0.12)', fontSize: 18, color: '#7a4545' }}>←</button>
        <h1 style={{ fontSize: 18, fontWeight: 700, color: '#5a2828', margin: 0 }}>👁️ Spectating {friendName}</h1>
        <div style={{ width: 42 }} />
      </div>

      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8, marginBottom: 8, flexShrink: 0 }}>
        <span style={{ fontSize: 22 }}>🐱</span>
        <div style={{ width: 90, height: 8, background: '#e0d0c8', borderRadius: 4, overflow: 'hidden' }}>
          <div style={{ width: `${(solvedCount / SIZE) * 100}%`, height: '100%', background: '#5a8a60', borderRadius: 4, transition: 'width 0.3s' }} />
        </div>
        <span style={{ fontWeight: 700, color: '#3a6a40', fontSize: 14 }}>{solvedCount}/{SIZE}</span>
      </div>

      <div ref={wrapperRef} style={{ flex: 1, minHeight: 0, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        <div
          ref={gridRef}
          style={{
            display: 'grid',
            gridTemplateColumns: `repeat(${SIZE}, 1fr)`,
            gap: GRID_GAP,
            background: 'white',
            padding: GRID_PAD,
            borderRadius: 16,
            boxShadow: '0 2px 12px rgba(0,0,0,0.1)',
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

              return (
                <div
                  key={`${r}-${c}`}
                  style={{
                    backgroundColor: bg, borderRadius: 5, display: 'flex',
                    alignItems: 'center', justifyContent: 'center', aspectRatio: '1',
                    position: 'relative', overflow: 'visible',
                  }}
                >
                  {state === 'marker' && <XMark color="#462323" opacity={0.6} />}
                  {state === 'question' && <QuestionMark color="#5a2828" opacity={0.7} />}
                  {state === 'cat' && <CatReveal variant="shatter" tileColor={bg} />}
                </div>
              )
            })
          )}
        </div>
      </div>
    </div>
  )
}
