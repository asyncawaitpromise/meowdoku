import { useState, useRef, useCallback, useLayoutEffect } from 'react'

type ColorId = 'P' | 'B' | 'V' | 'Y' | 'T' | 'G' | 'L' | 'S' | 'O' | 'R'

const COLOR_MAP: Record<ColorId, string> = {
  P: '#f080b0',
  B: '#a07858',
  V: '#9888d8',
  Y: '#f0d878',
  T: '#40b8c8',
  G: '#3d8b5a',
  L: '#88c870',
  S: '#6888c0',
  O: '#c0a820',
  R: '#d08888',
}

const GRID: ColorId[][] = [
  ['P','P','P','B','B','B','V','V','V','V'],
  ['P','P','Y','Y','Y','B','V','V','V','V'],
  ['P','Y','Y','Y','B','B','L','V','G','V'],
  ['T','Y','Y','Y','Y','B','L','V','G','G'],
  ['T','Y','Y','Y','B','B','L','G','G','R'],
  ['T','Y','Y','Y','Y','B','L','L','R','R'],
  ['T','Y','Y','Y','L','L','L','L','S','R'],
  ['T','Y','Y','Y','Y','Y','Y','Y','S','R'],
  ['T','T','Y','Y','T','O','O','S','S','S'],
  ['T','T','T','T','T','O','O','O','O','O'],
]

const SIZE = 10
const TOTAL_CATS = Object.keys(COLOR_MAP).length
const GRID_PAD = 8
const GRID_GAP = 3

type CellState = 'empty' | 'marker' | 'cat'

function XMark({ color }: { color: string }) {
  return (
    <svg viewBox="0 0 20 20" style={{ width: '54%', height: '54%', display: 'block', flexShrink: 0 }}>
      <line x1="5" y1="5" x2="15" y2="15" stroke={color} strokeWidth="3" strokeLinecap="round" />
      <line x1="15" y1="5" x2="5" y2="15" stroke={color} strokeWidth="3" strokeLinecap="round" />
    </svg>
  )
}

function getConflicts(board: CellState[][]): Set<string> {
  const out = new Set<string>()
  for (let r = 0; r < SIZE; r++) {
    for (let c = 0; c < SIZE; c++) {
      if (board[r][c] !== 'cat') continue
      for (let cc = 0; cc < SIZE; cc++) {
        if (cc !== c && board[r][cc] === 'cat') { out.add(`${r},${c}`); out.add(`${r},${cc}`) }
      }
      for (let rr = 0; rr < SIZE; rr++) {
        if (rr !== r && board[rr][c] === 'cat') { out.add(`${r},${c}`); out.add(`${rr},${c}`) }
      }
      const col = GRID[r][c]
      for (let rr = 0; rr < SIZE; rr++) {
        for (let cc = 0; cc < SIZE; cc++) {
          if ((rr !== r || cc !== c) && board[rr][cc] === 'cat' && GRID[rr][cc] === col) {
            out.add(`${r},${c}`); out.add(`${rr},${cc}`)
          }
        }
      }
      for (let dr = -1; dr <= 1; dr++) {
        for (let dc = -1; dc <= 1; dc++) {
          if (!dr && !dc) continue
          const nr = r + dr, nc = c + dc
          if (nr >= 0 && nr < SIZE && nc >= 0 && nc < SIZE && board[nr][nc] === 'cat') {
            out.add(`${r},${c}`); out.add(`${nr},${nc}`)
          }
        }
      }
    }
  }
  return out
}

export default function Home() {
  const emptyBoard = () => Array.from({ length: SIZE }, () => Array<CellState>(SIZE).fill('empty'))

  const [board, setBoard] = useState<CellState[][]>(emptyBoard)
  const boardRef = useRef(board)

  // Grid sizing: measure wrapper, pick min(width, height) so it's always square
  const wrapperRef = useRef<HTMLDivElement>(null)
  const gridRef = useRef<HTMLDivElement>(null)
  const [gridSize, setGridSize] = useState(0)

  useLayoutEffect(() => {
    const el = wrapperRef.current
    if (!el) return
    const measure = () => {
      const { width, height } = el.getBoundingClientRect()
      setGridSize(Math.min(width, height) - 2) // -2 for safety margin
    }
    measure()
    const ro = new ResizeObserver(measure)
    ro.observe(el)
    return () => ro.disconnect()
  }, [])

  // Pointer state refs
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

  const handlePointerDown = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
    const cell = getCellFromPoint(e.clientX, e.clientY)
    if (!cell) return
    const { r, c } = cell
    const now = Date.now()
    const lt = lastTap.current

    if (lt && lt.r === r && lt.c === c && now - lt.time < 300) {
      // Double-tap: place or remove cat
      lastTap.current = null
      paintMode.current = null
      updateBoard(prev => {
        const next = prev.map(row => [...row]) as CellState[][]
        next[r][c] = next[r][c] === 'cat' ? 'empty' : 'cat'
        return next
      })
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
  }, [getCellFromPoint, updateBoard])

  const handlePointerMove = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
    if (!paintMode.current) return
    const cell = getCellFromPoint(e.clientX, e.clientY)
    if (!cell) return
    const { r, c } = cell
    const key = `${r},${c}`
    if (key === lastPainted.current) return
    lastPainted.current = key
    lastTap.current = null // drag cancels double-tap

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
    const b = emptyBoard()
    boardRef.current = b
    setBoard(b)
    paintMode.current = null
    lastTap.current = null
    lastPainted.current = null
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  const conflicts = getConflicts(board)
  const catsPlaced = board.flat().filter(c => c === 'cat').length
  const isWon = catsPlaced === TOTAL_CATS && conflicts.size === 0

  const catFontSize = gridSize ? Math.round((gridSize - GRID_PAD * 2 - GRID_GAP * (SIZE - 1)) / SIZE * 0.6) : 16

  return (
    <div style={{
      position: 'fixed',
      inset: 0,
      backgroundColor: '#f0e8e0',
      fontFamily: 'system-ui, sans-serif',
      display: 'flex',
      flexDirection: 'column',
      overflow: 'hidden',
      padding: '0 12px',
      boxSizing: 'border-box',
    }}>

      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '10px 0 10px', flexShrink: 0 }}>
        <button onClick={reset} style={btnStyle}>←</button>
        <h1 style={{ fontSize: 20, fontWeight: 700, color: '#5a2828', margin: 0 }}>Level 1</h1>
        <button style={btnStyle}>⚙️</button>
      </div>

      {/* Rules — single scrollable row, no wrap */}
      <div style={{ display: 'flex', gap: 6, marginBottom: 8, flexShrink: 0, overflowX: 'auto', scrollbarWidth: 'none' }}>
        {['1 Cat per color', '1 Cat per row & column', 'Cats cannot touch'].map(rule => (
          <div key={rule} style={{ background: 'white', borderRadius: 10, padding: '5px 10px', fontSize: 12, color: '#6a4040', fontWeight: 500, border: '1px solid #e0d0c8', whiteSpace: 'nowrap', flexShrink: 0 }}>
            {rule}
          </div>
        ))}
      </div>

      {/* Progress */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8, flexShrink: 0 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <span style={{ fontSize: 22 }}>🐱</span>
          <div style={{ width: 90, height: 8, background: '#e0d0c8', borderRadius: 4, overflow: 'hidden' }}>
            <div style={{ width: `${(catsPlaced / TOTAL_CATS) * 100}%`, height: '100%', background: isWon ? '#3a8a50' : '#5a8a60', borderRadius: 4, transition: 'width 0.2s' }} />
          </div>
          <span style={{ fontWeight: 700, color: '#3a6a40', fontSize: 14 }}>{catsPlaced}/{TOTAL_CATS}</span>
        </div>
        <span style={{ fontSize: 18, letterSpacing: 2 }}>🐟🐟🐟</span>
      </div>

      {/* Win banner */}
      {isWon && (
        <div style={{ background: '#d4f0d8', border: '2px solid #5a8a60', borderRadius: 10, padding: '8px 12px', textAlign: 'center', marginBottom: 8, fontSize: 15, fontWeight: 700, color: '#3a6a40', flexShrink: 0 }}>
          🎉 Puzzle solved!
        </div>
      )}

      {/* Grid wrapper — takes remaining height */}
      <div
        ref={wrapperRef}
        style={{ flex: 1, minHeight: 0, display: 'flex', alignItems: 'center', justifyContent: 'center' }}
      >
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
          {GRID.map((row, r) =>
            row.map((colorId, c) => {
              const state = board[r][c]
              const conflict = conflicts.has(`${r},${c}`)
              return (
                <div
                  key={`${r}-${c}`}
                  style={{
                    backgroundColor: COLOR_MAP[colorId],
                    borderRadius: 5,
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    aspectRatio: '1',
                    position: 'relative',
                    overflow: 'hidden',
                  }}
                >
                  {state === 'marker' && <XMark color="rgba(70,35,35,0.65)" />}
                  {state === 'cat' && !conflict && (
                    <span style={{ fontSize: catFontSize, lineHeight: 1, pointerEvents: 'none' }}>🐱</span>
                  )}
                  {state === 'cat' && conflict && (
                    <>
                      <div style={{ position: 'absolute', inset: 0, background: 'rgba(200,0,0,0.22)' }} />
                      <XMark color="#c00000" />
                    </>
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
