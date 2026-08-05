import { useState, useRef, useCallback, useLayoutEffect, useEffect } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { useGameStore } from '../store/gameStore.ts'
import type { Difficulty } from '../store/gameStore.ts'
import { getHint, type GeneratedLevel, type Hint, type HintPart } from '../lib/levelGen'
import LevelGenWorker from '../lib/levelGen.worker?worker'

const GRID_PAD = 8
const GRID_GAP = 3
const MAX_FISH = 3

type CellState = 'empty' | 'marker' | 'cat'

function XMark({ color, opacity = 1, exiting = false }: { color: string; opacity?: number; exiting?: boolean }) {
  const anim = exiting
    ? 'xLineRemove 0.2s linear forwards'
    : 'xLineDraw 0.5s cubic-bezier(0.34, 1.56, 0.64, 1) forwards'
  return (
    <svg viewBox="0 0 20 20" style={{ width: '54%', height: '54%', display: 'block', flexShrink: 0 }}>
      <style>{`
        @keyframes xLineDraw  { from { transform: scaleX(0); } to { transform: scaleX(1); } }
        @keyframes xLineRemove { from { transform: scaleX(1); } to { transform: scaleX(0); } }
      `}</style>
      <g opacity={opacity}>
        <g transform="rotate(45, 10, 10)">
          <line x1="3" y1="10" x2="17" y2="10" stroke={color} strokeWidth="3" strokeLinecap="round"
            style={{ transformOrigin: '10px 10px', animation: anim }} />
        </g>
        <g transform="rotate(-45, 10, 10)">
          <line x1="3" y1="10" x2="17" y2="10" stroke={color} strokeWidth="3" strokeLinecap="round"
            style={{ transformOrigin: '10px 10px', animation: anim }} />
        </g>
      </g>
    </svg>
  )
}

const VALID_DIFFICULTIES = ['easy', 'medium', 'hard', 'expert'] as const

// Dumps the exact puzzle data to the console so a bad puzzle can be captured
// and reported. `regions`/`solution` alone are enough to reproduce and
// re-check the puzzle outside the app (e.g. against canSolveLogically).
function logPuzzleDebug(level: GeneratedLevel, meta: Record<string, unknown>) {
  console.groupCollapsed(`[meowdoku] puzzle generated — ${JSON.stringify(meta)}`)
  console.log('regions (regionId per cell):')
  console.table(level.regions)
  console.log('solution (solution[regionId] = {r, c}):', level.solution)
  console.log(
    `difficulty=${level.difficulty} easySteps=${level.easySteps} hardSteps=${level.hardSteps} ` +
    `boundaries=${level.boundaries} rounds=${level.rounds} symmetric=${level.symmetric}`
  )
  console.log('copy/paste JSON:', JSON.stringify({ regions: level.regions, solution: level.solution }))
  console.groupEnd()
}

export default function Game() {
  const { level: levelParam, difficulty: difficultyParam, index: indexParam } = useParams<{
    level?: string
    difficulty?: string
    index?: string
  }>()
  const isDifficultyMode = difficultyParam !== undefined && VALID_DIFFICULTIES.includes(difficultyParam as Difficulty)
  const difficulty = (isDifficultyMode ? difficultyParam : 'medium') as Difficulty
  const puzzleIndex = isDifficultyMode ? (Number(indexParam) || 1) : 0
  const levelNum = isDifficultyMode ? 1 : (Number(levelParam) || 1)
  const navigate = useNavigate()
  const { setLastLevel, puzzleSeed, markLevelComplete, markPuzzleComplete } = useGameStore()

  useEffect(() => {
    if (!isDifficultyMode) setLastLevel(levelNum)
  }, [levelNum, isDifficultyMode, setLastLevel])

  // Generate level in a Web Worker so the loading state stays responsive.
  const [level, setLevel] = useState<GeneratedLevel | null>(null)
  const [genStatus, setGenStatus] = useState('')
  useEffect(() => {
    setLevel(null)
    setGenStatus('')
    setBoard([])
    setSolvedRegions(new Set())
    const worker = new LevelGenWorker()
    worker.onmessage = (e: MessageEvent<{ type: string; level?: GeneratedLevel; msg?: string }>) => {
      if (e.data.type === 'progress') {
        setGenStatus(e.data.msg ?? '')
      } else {
        const lvl = e.data.level ?? null
        if (lvl) {
          logPuzzleDebug(lvl, isDifficultyMode
            ? { mode: 'difficulty', difficulty, puzzleIndex, globalSeed: puzzleSeed }
            : { mode: 'level', levelNum, puzzleSeed })
        }
        setLevel(lvl)
        worker.terminate()
      }
    }
    if (isDifficultyMode) {
      worker.postMessage({ type: 'generateLevelByDifficulty', difficulty, puzzleIndex, globalSeed: puzzleSeed })
    } else {
      worker.postMessage({ type: 'generateLevel', levelNum, puzzleSeed })
    }
    return () => worker.terminate()
  }, [levelNum, puzzleSeed, isDifficultyMode, difficulty, puzzleIndex]) // eslint-disable-line react-hooks/exhaustive-deps

  // ── Board state ──────────────────────────────────────────────────────────
  const makeEmpty = (n: number): CellState[][] =>
    Array.from({ length: n }, () => Array<CellState>(n).fill('empty'))

  const [board, setBoard] = useState<CellState[][]>([])
  const boardRef = useRef(board)

  const [solvedRegions, setSolvedRegions] = useState<Set<number>>(new Set())
  const [fishCount, setFishCount] = useState(MAX_FISH)
  const [errorCell, setErrorCell] = useState<{ r: number; c: number } | null>(null)
  const errorTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  const [hint, setHint] = useState<Hint | null>(null)

  const isWon = !!level && solvedRegions.size === level.size
  const isGameOver = fishCount === 0 && !isWon

  const [showWinModal, setShowWinModal] = useState(false)

  useEffect(() => {
    if (isWon) {
      if (isDifficultyMode) markPuzzleComplete(difficulty, puzzleIndex)
      else markLevelComplete(levelNum)
      setShowWinModal(true)
    }
  }, [isWon]) // eslint-disable-line react-hooks/exhaustive-deps

  // Reset board whenever a freshly generated level arrives (covers both the
  // levelNum/puzzleIndex-change case, since that always routes through a new
  // `level` via the generation effect above, and any regeneration). Gated on
  // `level` being present so the board is always sized to level.size — never
  // resets to a stale size while a puzzle is still generating.
  useEffect(() => {
    if (!level) return
    if (errorTimer.current) clearTimeout(errorTimer.current)
    const b = makeEmpty(level.size)
    boardRef.current = b
    setBoard(b)
    setSolvedRegions(new Set())
    setFishCount(MAX_FISH)
    setErrorCell(null)
    setHint(null)
    setShowWinModal(false)
    leavingTimers.current.forEach(clearTimeout)
    leavingTimers.current.clear()
    setLeavingMarkers(new Set())
  }, [level]) // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => () => { if (errorTimer.current) clearTimeout(errorTimer.current) }, [])

  // ── Grid sizing ──────────────────────────────────────────────────────────
  const wrapperRef = useRef<HTMLDivElement>(null)
  const gridRef = useRef<HTMLDivElement>(null)
  const [gridSize, setGridSize] = useState(0)

  useLayoutEffect(() => {
    const el = wrapperRef.current
    if (!el) return
    const measure = () => {
      const { width, height } = el.getBoundingClientRect()
      setGridSize(Math.min(width, height) - 2)
    }
    measure()
    const ro = new ResizeObserver(measure)
    ro.observe(el)
    return () => ro.disconnect()
  }, [])

  // ── Pointer tracking refs ────────────────────────────────────────────────
  const paintMode = useRef<'paint' | 'erase' | null>(null)
  const lastTap = useRef<{ r: number; c: number; time: number } | null>(null)
  const lastPainted = useRef<string | null>(null)

  const updateBoard = useCallback((fn: (prev: CellState[][]) => CellState[][]) => {
    setBoard(prev => {
      const next = fn(prev)
      boardRef.current = next
      return next
    })
  }, [])

  const [leavingMarkers, setLeavingMarkers] = useState<Set<string>>(new Set())
  const leavingTimers = useRef<Map<string, ReturnType<typeof setTimeout>>>(new Map())

  const removeMarker = useCallback((r: number, c: number) => {
    const key = `${r},${c}`
    updateBoard(prev => {
      const next = prev.map(row => [...row]) as CellState[][]
      next[r][c] = 'empty'
      return next
    })
    setLeavingMarkers(prev => new Set([...prev, key]))
    if (leavingTimers.current.has(key)) clearTimeout(leavingTimers.current.get(key)!)
    const t = setTimeout(() => {
      setLeavingMarkers(prev => { const s = new Set(prev); s.delete(key); return s })
      leavingTimers.current.delete(key)
    }, 220)
    leavingTimers.current.set(key, t)
  }, [updateBoard])

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
  }, [level])

  // ── Cat placement / validation ───────────────────────────────────────────
  const attemptPlace = useCallback((r: number, c: number) => {
    if (isWon || isGameOver || !level) return
    const cur = boardRef.current[r][c]

    if (cur === 'cat') {
      // Remove a correctly placed cat
      const regionId = level.regions[r][c]
      updateBoard(prev => {
        const next = prev.map(row => [...row]) as CellState[][]
        next[r][c] = 'empty'
        return next
      })
      setSolvedRegions(prev => { const s = new Set(prev); s.delete(regionId); return s })
      return
    }

    const regionId = level.regions[r][c]
    const sol = level.solution[regionId]

    if (sol.r === r && sol.c === c) {
      // ✓ Correct
      updateBoard(prev => {
        const next = prev.map(row => [...row]) as CellState[][]
        next[r][c] = 'cat'
        return next
      })
      setSolvedRegions(prev => new Set([...prev, regionId]))
    } else {
      // ✗ Wrong — flash error, deduct fish
      if (errorTimer.current) clearTimeout(errorTimer.current)
      setFishCount(prev => Math.max(0, prev - 1))
      setErrorCell({ r, c })
      errorTimer.current = setTimeout(() => setErrorCell(null), 900)
    }
  }, [isWon, isGameOver, level, updateBoard])

  // ── Pointer handlers ─────────────────────────────────────────────────────
  const handlePointerDown = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
    const cell = getCellFromPoint(e.clientX, e.clientY)
    if (!cell) return
    const { r, c } = cell
    const now = Date.now()
    const lt = lastTap.current

    if (lt && lt.r === r && lt.c === c && now - lt.time < 300) {
      lastTap.current = null
      paintMode.current = null
      attemptPlace(r, c)
      return
    }

    lastTap.current = { r, c, time: now }
    lastPainted.current = `${r},${c}`
    e.currentTarget.setPointerCapture(e.pointerId)

    const cur = boardRef.current[r][c]
    if (cur === 'empty') {
      paintMode.current = 'paint'
      updateBoard(prev => {
        const next = prev.map(row => [...row]) as CellState[][]
        next[r][c] = 'marker'
        return next
      })
    } else if (cur === 'marker') {
      paintMode.current = 'erase'
      removeMarker(r, c)
    } else {
      paintMode.current = null
    }
  }, [getCellFromPoint, attemptPlace, updateBoard, removeMarker])

  const handlePointerMove = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
    if (!paintMode.current) return
    const cell = getCellFromPoint(e.clientX, e.clientY)
    if (!cell) return
    const { r, c } = cell
    const key = `${r},${c}`
    if (key === lastPainted.current) return
    lastPainted.current = key
    lastTap.current = null

    const cur = boardRef.current[r][c]
    if (paintMode.current === 'paint' && cur === 'empty') {
      updateBoard(prev => {
        const next = prev.map(row => [...row]) as CellState[][]
        next[r][c] = 'marker'
        return next
      })
    } else if (paintMode.current === 'erase' && cur === 'marker') {
      removeMarker(r, c)
    }
  }, [getCellFromPoint, updateBoard, removeMarker])

  const handlePointerUp = useCallback(() => {
    paintMode.current = null
    lastPainted.current = null
  }, [])

  const reset = useCallback(() => {
    if (!level) return
    if (errorTimer.current) clearTimeout(errorTimer.current)
    const b = makeEmpty(level.size)
    boardRef.current = b
    setBoard(b)
    setSolvedRegions(new Set())
    setFishCount(MAX_FISH)
    setErrorCell(null)
    paintMode.current = null
    lastTap.current = null
    lastPainted.current = null
    leavingTimers.current.forEach(clearTimeout)
    leavingTimers.current.clear()
    setLeavingMarkers(new Set())
  }, [level]) // eslint-disable-line react-hooks/exhaustive-deps

  // ── Derived display values ───────────────────────────────────────────────
  const SIZE = level?.size ?? 10
  const catFontSize = gridSize
    ? Math.round((gridSize - GRID_PAD * 2 - GRID_GAP * (SIZE - 1)) / SIZE * 0.6)
    : 16

  // Guards against a one-frame render with `level` set but `board` not yet
  // resized to match (the reset effect above runs after this render commits).
  if (!level || board.length !== level.size) return (
    <div style={{
      position: 'fixed', inset: 0, backgroundColor: '#f0e8e0',
      display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
      gap: 16, fontFamily: 'system-ui, sans-serif',
    }}>
      <span style={{ fontSize: 48, animation: 'spin 1.2s linear infinite' }}>🐱</span>
      <p style={{ color: '#7a4545', fontWeight: 600, fontSize: 16, margin: 0 }}>Generating puzzle…</p>
      {genStatus && <p style={{ color: '#a06060', fontSize: 13, margin: 0 }}>{genStatus}</p>}
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
          {isDifficultyMode
            ? `${difficulty.charAt(0).toUpperCase() + difficulty.slice(1)} · #${puzzleIndex}`
            : `Level ${levelNum}`}
        </h1>
        <button onClick={reset} title="Restart" style={btnStyle}>↺</button>
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
              const state = board[r][c]
              const isError = errorCell?.r === r && errorCell?.c === c
              const isLeaving = leavingMarkers.has(`${r},${c}`)

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
                  {!isError && state === 'marker' && <XMark color="#462323" opacity={0.6} />}
                  {!isError && isLeaving && state !== 'marker' && <XMark color="#462323" opacity={0.6} exiting />}
                  {!isError && state === 'cat' && (
                    <span style={{ fontSize: catFontSize, lineHeight: 1, pointerEvents: 'none', position: 'relative', zIndex: 1 }}>🐱</span>
                  )}
                </div>
              )
            })
          )}
        </div>
      </div>

      {/* Bottom buttons */}
      <div style={{ display: 'flex', justifyContent: 'center', gap: 24, padding: '12px 0 16px', flexShrink: 0 }}>
        {[{ emoji: '🐱', label: 'Watch ad', onClick: undefined as (() => void) | undefined }, { emoji: '💡', label: 'Hint', onClick: () => {
            const marked = new Set<number>()
            board.forEach((row, r) => row.forEach((cell, c) => { if (cell === 'marker') marked.add(r * SIZE + c) }))
            const h = getHint(level, solvedRegions, marked)
            setHint(h ?? { parts: [{ type: 'text', text: 'No hint available right now.' }] })
          } }].map(({ emoji, label, onClick }) => (
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
                {isDifficultyMode
                  ? `${difficulty.charAt(0).toUpperCase() + difficulty.slice(1)} #${puzzleIndex} solved`
                  : `Level ${levelNum} solved`}
              </div>
            </div>
            {isDifficultyMode ? (
              <button
                onClick={() => { setShowWinModal(false); navigate(`/game/${difficulty}/${puzzleIndex + 1}`) }}
                style={{ background: '#3a8a50', color: 'white', border: 'none', borderRadius: 14, padding: '12px 32px', fontSize: 16, fontWeight: 700, cursor: 'pointer', width: '100%' }}
              >
                Next Puzzle →
              </button>
            ) : levelNum < 50 ? (
              <button
                onClick={() => { setShowWinModal(false); navigate(`/game/${levelNum + 1}`) }}
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
