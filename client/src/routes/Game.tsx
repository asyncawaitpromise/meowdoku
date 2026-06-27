import { useState, useRef, useCallback, useLayoutEffect, useEffect, useMemo } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { useGameStore } from '../store/gameStore.ts'
import { generateLevel } from '../lib/levelGen.ts'

const GRID_PAD = 8
const GRID_GAP = 3
const SIZE = 10
const MAX_FISH = 3

type CellState = 'empty' | 'marker' | 'cat'

function XMark({ color }: { color: string }) {
  return (
    <svg viewBox="0 0 20 20" style={{ width: '54%', height: '54%', display: 'block', flexShrink: 0 }}>
      <line x1="5" y1="5" x2="15" y2="15" stroke={color} strokeWidth="3" strokeLinecap="round" />
      <line x1="15" y1="5" x2="5" y2="15" stroke={color} strokeWidth="3" strokeLinecap="round" />
    </svg>
  )
}

export default function Game() {
  const { level: levelParam } = useParams<{ level: string }>()
  const levelNum = Number(levelParam) || 1
  const navigate = useNavigate()
  const setLastLevel = useGameStore(s => s.setLastLevel)

  useEffect(() => { setLastLevel(levelNum) }, [levelNum, setLastLevel])

  const level = useMemo(() => generateLevel(levelNum), [levelNum])

  // ── Board state ──────────────────────────────────────────────────────────
  const makeEmpty = (): CellState[][] =>
    Array.from({ length: SIZE }, () => Array<CellState>(SIZE).fill('empty'))

  const [board, setBoard] = useState<CellState[][]>(makeEmpty)
  const boardRef = useRef(board)

  const [solvedRegions, setSolvedRegions] = useState<Set<number>>(new Set())
  const [fishCount, setFishCount] = useState(MAX_FISH)
  const [errorCell, setErrorCell] = useState<{ r: number; c: number } | null>(null)
  const errorTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  const isWon = solvedRegions.size === SIZE
  const isGameOver = fishCount === 0 && !isWon

  // Reset board when level number changes
  useEffect(() => {
    if (errorTimer.current) clearTimeout(errorTimer.current)
    const b = makeEmpty()
    boardRef.current = b
    setBoard(b)
    setSolvedRegions(new Set())
    setFishCount(MAX_FISH)
    setErrorCell(null)
  }, [levelNum]) // eslint-disable-line react-hooks/exhaustive-deps

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

  const getCellFromPoint = useCallback((clientX: number, clientY: number) => {
    const el = gridRef.current
    if (!el) return null
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
  }, [])

  // ── Cat placement / validation ───────────────────────────────────────────
  const attemptPlace = useCallback((r: number, c: number) => {
    if (isWon || isGameOver) return
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
      updateBoard(prev => {
        const next = prev.map(row => [...row]) as CellState[][]
        next[r][c] = 'empty'
        return next
      })
    } else {
      paintMode.current = null
    }
  }, [getCellFromPoint, attemptPlace, updateBoard])

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
      updateBoard(prev => {
        const next = prev.map(row => [...row]) as CellState[][]
        next[r][c] = 'empty'
        return next
      })
    }
  }, [getCellFromPoint, updateBoard])

  const handlePointerUp = useCallback(() => {
    paintMode.current = null
    lastPainted.current = null
  }, [])

  const reset = useCallback(() => {
    if (errorTimer.current) clearTimeout(errorTimer.current)
    const b = makeEmpty()
    boardRef.current = b
    setBoard(b)
    setSolvedRegions(new Set())
    setFishCount(MAX_FISH)
    setErrorCell(null)
    paintMode.current = null
    lastTap.current = null
    lastPainted.current = null
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  // ── Derived display values ───────────────────────────────────────────────
  const catFontSize = gridSize
    ? Math.round((gridSize - GRID_PAD * 2 - GRID_GAP * (SIZE - 1)) / SIZE * 0.6)
    : 16

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
        <button onClick={() => navigate(-1)} style={btnStyle}>←</button>
        <h1 style={{ fontSize: 20, fontWeight: 700, color: '#5a2828', margin: 0 }}>Level {levelNum}</h1>
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
      {isWon && (
        <div style={{ background: '#d4f0d8', border: '2px solid #5a8a60', borderRadius: 10, padding: '8px 12px', textAlign: 'center', marginBottom: 8, fontSize: 15, fontWeight: 700, color: '#3a6a40', flexShrink: 0 }}>
          🎉 Puzzle solved!
        </div>
      )}
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
                      <XMark color="#b00000" />
                    </>
                  )}
                  {!isError && state === 'marker' && <XMark color="rgba(70,35,35,0.6)" />}
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
        {[{ emoji: '🐱', label: 'Watch ad' }, { emoji: '💡', label: 'Hint' }].map(({ emoji, label }) => (
          <button key={label} title={label} style={{ width: 68, height: 68, borderRadius: '50%', background: 'white', border: 'none', boxShadow: '0 2px 12px rgba(0,0,0,0.15)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 30, cursor: 'pointer', position: 'relative' }}>
            {emoji}
            <div style={{ position: 'absolute', top: 0, right: 0, width: 20, height: 20, background: '#22cc44', borderRadius: '50%', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 8, color: 'white', fontWeight: 700 }}>▶</div>
          </button>
        ))}
      </div>

    </div>
  )
}

const btnStyle: React.CSSProperties = {
  width: 42, height: 42, borderRadius: '50%', background: 'white', border: 'none',
  cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center',
  boxShadow: '0 1px 4px rgba(0,0,0,0.12)', fontSize: 18, color: '#7a4545', flexShrink: 0,
}
