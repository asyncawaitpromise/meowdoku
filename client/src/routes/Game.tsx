import { useNavigate, useParams } from 'react-router-dom'
import { useGameStore } from '../store/gameStore.ts'
import type { Difficulty } from '../store/gameStore.ts'
import type { HintPart } from '../lib/levelGen'
import { useGameSession } from '../hooks/useGameSession'
import { useGridSize } from '../hooks/useGridSize'
import { XMark } from '../components/XMark'
import { CatMark } from '../components/CatMark'

const GRID_PAD = 8
const GRID_GAP = 3
const MAX_FISH = 3

const VALID_DIFFICULTIES = ['easy', 'medium', 'hard', 'expert'] as const

export default function Game() {
  const { level: levelParam, difficulty: difficultyParam, index: indexParam, code: codeParam } = useParams<{
    level?: string
    difficulty?: string
    index?: string
    code?: string
  }>()
  const isSharedMode = codeParam !== undefined
  const isDifficultyMode = !isSharedMode && difficultyParam !== undefined && VALID_DIFFICULTIES.includes(difficultyParam as Difficulty)
  const difficulty = (isDifficultyMode ? difficultyParam : 'medium') as Difficulty
  const puzzleIndex = isDifficultyMode ? (Number(indexParam) || 1) : 0
  const levelNum = isDifficultyMode || isSharedMode ? 1 : (Number(levelParam) || 1)
  const navigate = useNavigate()
  const { puzzleSeed } = useGameStore()

  const gameId = isSharedMode ? `shared-${codeParam}` : isDifficultyMode ? `puzzle-${difficulty}-${puzzleIndex}` : `level-${levelNum}`

  const { wrapperRef, gridRef, gridSize } = useGridSize()
  const {
    level, genStatus, shareError,
    board, solvedRegions, fishCount, errorCell, wrongCells, leavingMarkers,
    hint, setHint, requestHint,
    isWon, isGameOver, showWinModal, setShowWinModal,
    handlePointerDown, handlePointerMove, handlePointerUp,
    handleShare, shareCopied,
    reset,
  } = useGameSession(
    { gameId, levelNum, puzzleSeed, isDifficultyMode, difficulty, puzzleIndex, isSharedMode, codeParam },
    gridRef,
  )

  // ── Derived display values ───────────────────────────────────────────────
  const SIZE = level?.size ?? 10

  if (shareError) return (
    <div style={{
      position: 'fixed', inset: 0, backgroundColor: '#f0e8e0',
      display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
      gap: 12, fontFamily: 'system-ui, sans-serif', padding: 24, textAlign: 'center',
    }}>
      <span style={{ fontSize: 48 }}>🙀</span>
      <p style={{ color: '#7a2828', fontWeight: 700, fontSize: 17, margin: 0 }}>This shared puzzle link looks broken</p>
      <p style={{ color: '#a06060', fontSize: 13, margin: 0 }}>The code may have been cut off when it was copied or sent.</p>
      <button onClick={() => navigate('/')} style={{ marginTop: 8, background: '#5a2828', color: 'white', border: 'none', borderRadius: 12, padding: '10px 24px', fontSize: 14, fontWeight: 700, cursor: 'pointer' }}>
        Back home
      </button>
    </div>
  )

  // Guards against a one-frame render with `level` set but `board` not yet
  // resized to match (the reset effect above runs after this render commits).
  if (!level || board.length !== level.size) return (
    <div style={{
      position: 'fixed', inset: 0, backgroundColor: '#f0e8e0',
      display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
      gap: 16, fontFamily: 'system-ui, sans-serif',
    }}>
      <div style={{ width: 86, height: 86, display: 'flex', alignItems: 'center', justifyContent: 'center', animation: 'spin 1.2s linear infinite' }}><CatMark /></div>
      <p style={{ color: '#7a4545', fontWeight: 600, fontSize: 16, margin: 0 }}>Generating puzzle…</p>
      {genStatus.some(s => s) && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 2, alignItems: 'center' }}>
          {genStatus.map((s, i) => s && (
            <p key={i} style={{ color: '#a06060', fontSize: 13, margin: 0 }}>{genStatus.length > 1 ? `${i + 1}. ${s}` : s}</p>
          ))}
        </div>
      )}
      <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
    </div>
  )

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

      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '10px 0', flexShrink: 0 }}>
        <button
          onClick={() => isDifficultyMode ? navigate(`/levels/${difficulty}`) : navigate('/')}
          style={btnStyle}
        >←</button>
        <h1 style={{ fontSize: 20, fontWeight: 700, color: '#5a2828', margin: 0 }}>
          {isSharedMode
            ? 'Shared Puzzle'
            : isDifficultyMode
            ? `${difficulty.charAt(0).toUpperCase() + difficulty.slice(1)} · #${puzzleIndex}`
            : `Level ${levelNum}`}
          {isDifficultyMode && level && !level.gateMet && (
            <span
              title={`This puzzle didn't fully reach ${difficulty}'s target technique mix — generation fell back to a solvable but easier layout.`}
              style={{ fontSize: 13, color: '#b08868', marginLeft: 4, cursor: 'help' }}
            >*</span>
          )}
        </h1>
        <div style={{ display: 'flex', gap: 8 }}>
          <button onClick={handleShare} title="Share this puzzle" style={btnStyle}>{shareCopied ? '✓' : '🔗'}</button>
          <button onClick={reset} title="Restart" style={btnStyle}>↺</button>
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

      {/* Progress + Fish */}
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
      {isGameOver && (
        <div style={{ background: '#f0d4d4', border: '2px solid #a05050', borderRadius: 10, padding: '8px 16px', marginBottom: 8, flexShrink: 0, display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <span style={{ fontSize: 14, fontWeight: 700, color: '#7a2828' }}>No lives left!</span>
          <button onClick={reset} style={{ background: '#7a2828', color: 'white', border: 'none', borderRadius: 8, padding: '5px 14px', fontSize: 13, fontWeight: 600, cursor: 'pointer' }}>Try again</button>
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
                    overflow: 'hidden',
                  }}
                >
                  {isError && (
                    <>
                      <div style={{ position: 'absolute', inset: 0, background: 'rgba(200,0,0,0.28)' }} />
                      <XMark color="#b00000" opacity={1} />
                    </>
                  )}
                  {!isError && state === 'marker' && isWrong && (
                    <>
                      <div style={{ position: 'absolute', inset: 0, background: 'rgba(200,0,0,0.28)' }} />
                      <XMark color="#b00000" opacity={1} static />
                    </>
                  )}
                  {!isError && state === 'marker' && !isWrong && <XMark color="#462323" opacity={0.6} />}
                  {!isError && isLeaving && state === 'empty' && <XMark color="#462323" opacity={0.6} exiting />}
                  {state === 'cat' && <CatMark />}
                </div>
              )
            })
          )}
        </div>
      </div>

      {/* Bottom buttons */}
      <div style={{ display: 'flex', justifyContent: 'center', gap: 24, padding: '12px 0 16px', flexShrink: 0 }}>
        {[{ emoji: '🐱', label: 'Watch ad', onClick: undefined as (() => void) | undefined }, { emoji: '💡', label: 'Hint', onClick: requestHint }].map(({ emoji, label, onClick }) => (
          <button key={label} title={label} onClick={onClick} style={{ width: 68, height: 68, borderRadius: '50%', background: 'white', border: 'none', boxShadow: '0 2px 12px rgba(0,0,0,0.15)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 30, cursor: 'pointer', position: 'relative' }}>
            {emoji}
            <div style={{ position: 'absolute', top: 0, right: 0, width: 20, height: 20, background: '#22cc44', borderRadius: '50%', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 8, color: 'white', fontWeight: 700 }}>▶</div>
          </button>
        ))}
      </div>

      {/* Win modal */}
      {showWinModal && (
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
              <div style={{ fontSize: 22, fontWeight: 800, color: '#3a6a40' }}>Puzzle Complete!</div>
              <div style={{ fontSize: 15, color: '#7a5040', marginTop: 6 }}>
                {isSharedMode
                  ? 'Shared puzzle solved'
                  : isDifficultyMode
                  ? `${difficulty.charAt(0).toUpperCase() + difficulty.slice(1)} #${puzzleIndex} solved`
                  : `Level ${levelNum} solved`}
              </div>
              {isDifficultyMode && level && !level.gateMet && (
                <div style={{ fontSize: 12, color: '#b08868', marginTop: 2 }}>
                  * a bit easier than usual for this difficulty
                </div>
              )}
            </div>
            {isSharedMode ? (
              <button
                onClick={() => navigate('/')}
                style={{ background: '#3a8a50', color: 'white', border: 'none', borderRadius: 14, padding: '12px 32px', fontSize: 16, fontWeight: 700, cursor: 'pointer', width: '100%' }}
              >
                Back home →
              </button>
            ) : isDifficultyMode ? (
              <button
                onClick={() => { setShowWinModal(false); navigate(`/game/${difficulty}/${puzzleIndex + 1}`, { replace: true }) }}
                style={{ background: '#3a8a50', color: 'white', border: 'none', borderRadius: 14, padding: '12px 32px', fontSize: 16, fontWeight: 700, cursor: 'pointer', width: '100%' }}
              >
                Next Puzzle →
              </button>
            ) : levelNum < 50 ? (
              <button
                onClick={() => { setShowWinModal(false); navigate(`/game/${levelNum + 1}`, { replace: true }) }}
                style={{ background: '#3a8a50', color: 'white', border: 'none', borderRadius: 14, padding: '12px 32px', fontSize: 16, fontWeight: 700, cursor: 'pointer', width: '100%' }}
              >
                Next Level →
              </button>
            ) : (
              <div style={{ fontSize: 15, fontWeight: 700, color: '#5a2828', textAlign: 'center' }}>You've completed all levels!</div>
            )}
            <button
              onClick={() => setShowWinModal(false)}
              style={{ background: 'none', border: 'none', color: '#a07060', fontSize: 14, cursor: 'pointer', padding: 0 }}
            >
              Stay on this level
            </button>
          </div>
        </div>
      )}

      {/* Hint toast — floats over grid, no reflow */}
      {hint && (
        <div style={{
          position: 'absolute', left: 12, right: 12, bottom: 104,
          background: '#fff8e8', border: '1.5px solid #d4a830',
          borderRadius: 12, padding: '10px 14px',
          display: 'flex', alignItems: 'flex-start', gap: 8,
          boxShadow: '0 4px 16px rgba(0,0,0,0.18)',
          zIndex: 20,
        }}>
          <span style={{ fontSize: 16, flexShrink: 0 }}>💡</span>
          <span style={{ fontSize: 13, color: '#7a5010', flex: 1, lineHeight: 1.45 }}>
            {hint.parts.map((part: HintPart, i: number) =>
              part.type === 'region'
                ? <span key={i} style={{
                    display: 'inline-block',
                    width: 13, height: 13,
                    borderRadius: 3,
                    backgroundColor: level.colors[part.regionId],
                    verticalAlign: 'middle',
                    margin: '0 2px',
                    border: '1px solid rgba(0,0,0,0.18)',
                    flexShrink: 0,
                  }} />
                : <span key={i}>{part.text}</span>
            )}
          </span>
          <button onClick={() => setHint(null)} style={{ background: 'none', border: 'none', fontSize: 18, cursor: 'pointer', color: '#a07030', padding: 0, lineHeight: 1, flexShrink: 0 }}>×</button>
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
