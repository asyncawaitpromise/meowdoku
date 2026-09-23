import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { useGameStore } from '../store/gameStore.ts'
import type { CellState, Difficulty } from '../store/gameStore.ts'
import { TUTORIAL_LEVEL } from '../lib/tutorialLevel'
import { useGridSize } from '../hooks/useGridSize'
import { useBoardGestures } from '../hooks/useBoardGestures'
import { getContainerRect } from '../lib/containerRect.ts'
import { XMark } from '../components/XMark'
import { CatReveal } from '../components/CatReveal'
import { QuestionMark } from '../components/QuestionMark'
import { HoldMenu } from '../components/HoldMenu'
import { TutorialOverlay, type SpotlightRect, type GesturePrompt } from '../components/TutorialOverlay'

const GRID_PAD = 8
const GRID_GAP = 3
const SIZE = TUTORIAL_LEVEL.size

const VALID_DIFFICULTIES = ['easy', 'medium', 'hard', 'expert'] as const

const makeEmptyBoard = (): CellState[][] =>
  Array.from({ length: SIZE }, () => Array<CellState>(SIZE).fill('empty'))

type Highlight =
  | { type: 'cell'; r: number; c: number }
  | { type: 'row'; r: number }
  | { type: 'col'; c: number }
  | { type: 'region'; regionId: number }

function cellsForHighlight(h: Highlight): { r: number; c: number }[] {
  switch (h.type) {
    case 'cell':
      return [{ r: h.r, c: h.c }]
    case 'row':
      return Array.from({ length: SIZE }, (_, c) => ({ r: h.r, c }))
    case 'col':
      return Array.from({ length: SIZE }, (_, r) => ({ r, c: h.c }))
    case 'region': {
      const cells: { r: number; c: number }[] = []
      TUTORIAL_LEVEL.regions.forEach((row, r) => row.forEach((regionId, c) => {
        if (regionId === h.regionId) cells.push({ r, c })
      }))
      return cells
    }
  }
}

interface InfoStep {
  kind: 'info'
  message: string
  highlight?: Highlight[]
}

interface ActionStep {
  kind: 'action'
  message: string
  highlight: Highlight[]
  gesture: { kind: GesturePrompt['kind']; r: number; c: number }
  isComplete: (board: CellState[][]) => boolean
}

type TutorialStep = InfoStep | ActionStep

export default function Tutorial() {
  const navigate = useNavigate()
  const { difficulty: difficultyParam } = useParams<{ difficulty: string }>()
  const doubleTapToPlaceCat = useGameStore(s => s.doubleTapToPlaceCat)
  const catAnimation = useGameStore(s => s.catAnimation)

  const difficulty = (VALID_DIFFICULTIES.includes(difficultyParam as Difficulty) ? difficultyParam : 'medium') as Difficulty

  const catGesture: GesturePrompt['kind'] = doubleTapToPlaceCat ? 'doubletap' : 'hold'
  const catInstruction = doubleTapToPlaceCat
    ? 'Tap it twice fast to place a cat 🐱'
    : 'Press and hold, then drag up to 🐱'

  const steps = useMemo<TutorialStep[]>(() => [
    {
      kind: 'info',
      message: "Welcome to Meowdoku! 🐾 Pop one cat in every colored region. One per row, one per column, and cats can never touch, not even diagonally.",
    },
    {
      kind: 'info',
      message: 'Every colored region needs exactly one cat 🐱',
      highlight: [{ type: 'region', regionId: 0 }],
    },
    {
      kind: 'info',
      message: 'Every row gets one cat too 🐈',
      highlight: [{ type: 'row', r: 1 }],
    },
    {
      kind: 'info',
      message: 'Same for columns, just one cat each 😺',
      highlight: [{ type: 'col', c: 0 }],
    },
    {
      kind: 'action',
      message: 'Tap a cell to mark it with an X ✖️ that means "no cat here". Try the glowing one!',
      highlight: [{ type: 'cell', r: 0, c: 0 }],
      gesture: { kind: 'tap', r: 0, c: 0 },
      isComplete: board => board[0][0] === 'marker',
    },
    {
      kind: 'action',
      message: `Now place a cat. ${catInstruction}`,
      highlight: [{ type: 'cell', r: 1, c: 0 }],
      gesture: { kind: catGesture, r: 1, c: 0 },
      isComplete: board => board[1][0] === 'cat',
    },
    {
      kind: 'info',
      message: "That cat fills its region, row, and column, plus cats can't touch diagonally. Everything glowing is safe to X 🙀",
      highlight: [{ type: 'region', regionId: 0 }, { type: 'row', r: 1 }, { type: 'col', c: 0 }, { type: 'cell', r: 2, c: 1 }],
    },
    {
      kind: 'info',
      message: 'Your turn! Place the last 3 cats 🐈‍⬛✨',
    },
  ], [catGesture, catInstruction])

  const [stepIndex, setStepIndex] = useState(0)
  const currentStep = stepIndex < steps.length ? steps[stepIndex] : null

  const { wrapperRef, gridRef, gridSize } = useGridSize()

  const [board, setBoard] = useState<CellState[][]>(makeEmptyBoard)
  const boardRef = useRef(board)
  const [solvedRegions, setSolvedRegions] = useState<Set<number>>(new Set())
  const [wrongCells, setWrongCells] = useState<Set<string>>(new Set())
  const wrongCellsRef = useRef(wrongCells)
  const [errorCell, setErrorCell] = useState<{ r: number; c: number } | null>(null)
  const errorTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  const isWon = solvedRegions.size === SIZE

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
  }, [gridRef])

  const getCellState = useCallback((r: number, c: number) => boardRef.current[r][c], [])
  const isCellLocked = useCallback((r: number, c: number) =>
    wrongCellsRef.current.has(`${r},${c}`) || boardRef.current[r][c] === 'cat',
  [])

  const setCellState = useCallback((r: number, c: number, state: Exclude<CellState, 'cat'>) => {
    updateBoard(prev => {
      const next = prev.map(row => [...row]) as CellState[][]
      next[r][c] = state
      return next
    })
  }, [updateBoard])

  const attemptCat = useCallback((r: number, c: number) => {
    if (wrongCellsRef.current.has(`${r},${c}`) || boardRef.current[r][c] === 'cat') return
    const regionId = TUTORIAL_LEVEL.regions[r][c]
    const sol = TUTORIAL_LEVEL.solution[regionId]

    if (sol.r === r && sol.c === c) {
      updateBoard(prev => {
        const next = prev.map(row => [...row]) as CellState[][]
        next[r][c] = 'cat'
        return next
      })
      setSolvedRegions(prev => new Set([...prev, regionId]))
    } else {
      if (errorTimer.current) clearTimeout(errorTimer.current)
      setErrorCell({ r, c })
      updateBoard(prev => {
        const next = prev.map(row => [...row]) as CellState[][]
        next[r][c] = 'marker'
        return next
      })
      setWrongCells(prev => new Set(prev).add(`${r},${c}`))
      wrongCellsRef.current = new Set(wrongCellsRef.current).add(`${r},${c}`)
      errorTimer.current = setTimeout(() => setErrorCell(null), 900)
    }
  }, [updateBoard])

  useEffect(() => () => { if (errorTimer.current) clearTimeout(errorTimer.current) }, [])

  const { handlePointerDown, handlePointerMove, handlePointerUp, handlePointerCancel, handlePointerLeave, holdMenu } = useBoardGestures({
    getCellFromPoint,
    getCellState,
    isLocked: isCellLocked,
    setCellState,
    attemptCat,
    doubleTapEnabled: doubleTapToPlaceCat,
  })

  // Auto-advance a guided "do this" step once the board reflects the action.
  useEffect(() => {
    const step = currentStep
    if (!step || step.kind !== 'action') return
    if (step.isComplete(board)) {
      const t = setTimeout(() => setStepIndex(i => i + 1), 550)
      return () => clearTimeout(t)
    }
  }, [board, currentStep])

  // The overlay this feeds is `position: fixed`, which on desktop is scoped
  // to the transformed `.phone-screen` box rather than the real viewport —
  // see getContainerRect. getBoundingClientRect() is always viewport-relative,
  // so it has to be translated into that box's local coordinates here, or
  // every spotlight/gesture icon lands off-screen on desktop.
  const getCellRect = useCallback((r: number, c: number): SpotlightRect | null => {
    const el = gridRef.current
    if (!el) return null
    const rect = el.getBoundingClientRect()
    const container = getContainerRect()
    const inner = rect.width - GRID_PAD * 2
    const innerH = rect.height - GRID_PAD * 2
    const cellW = (inner - GRID_GAP * (SIZE - 1)) / SIZE
    const cellH = (innerH - GRID_GAP * (SIZE - 1)) / SIZE
    return {
      x: rect.left - container.left + GRID_PAD + c * (cellW + GRID_GAP),
      y: rect.top - container.top + GRID_PAD + r * (cellH + GRID_GAP),
      width: cellW,
      height: cellH,
    }
  }, [gridRef])

  // Recomputed every render (cheap — at most 16 cells) so it tracks gridSize
  // changes without needing its own resize listener.
  const spotlights: SpotlightRect[] = !isWon && currentStep?.highlight
    ? currentStep.highlight.flatMap(cellsForHighlight).map(({ r, c }) => getCellRect(r, c)).filter((r): r is SpotlightRect => r !== null)
    : []

  const gesturePrompt: GesturePrompt | undefined = !isWon && currentStep?.kind === 'action'
    ? (() => {
        const rect = getCellRect(currentStep.gesture.r, currentStep.gesture.c)
        return rect ? { kind: currentStep.gesture.kind, x: rect.x + rect.width / 2, y: rect.y + rect.height / 2 } : undefined
      })()
    : undefined

  const goToLevelOne = () => navigate(`/game/${difficulty}/1`)
  const goToLevels = () => navigate(`/levels/${difficulty}`)

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
        <button onClick={goToLevels} style={btnStyle}>←</button>
        <h1 style={{ fontSize: 20, fontWeight: 700, color: '#5a2828', margin: 0 }}>How to Play</h1>
        <button onClick={goToLevels} style={{ ...btnStyle, width: 'auto', borderRadius: 20, padding: '0 14px', fontSize: 13, fontWeight: 700 }}>
          Skip →
        </button>
      </div>

      {/* Grid */}
      <div ref={wrapperRef} style={{ flex: 1, minHeight: 0, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        <div
          ref={gridRef}
          onPointerDown={handlePointerDown}
          onPointerMove={handlePointerMove}
          onPointerUp={handlePointerUp}
          onPointerLeave={handlePointerLeave}
          onPointerCancel={handlePointerCancel}
          onContextMenu={(e) => e.preventDefault()}
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
            WebkitUserSelect: 'none',
            WebkitTouchCallout: 'none',
            WebkitTapHighlightColor: 'transparent',
            width: gridSize || '100%',
            height: gridSize || undefined,
            boxSizing: 'border-box',
          }}
        >
          {Array.from({ length: SIZE }, (_, r) =>
            Array.from({ length: SIZE }, (_, c) => {
              const regionId = TUTORIAL_LEVEL.regions[r][c]
              const bg = TUTORIAL_LEVEL.colors[regionId]
              const key = `${r},${c}`
              const state = board[r][c]
              const isError = errorCell?.r === r && errorCell?.c === c
              const isWrong = wrongCells.has(key)

              return (
                <div
                  key={key}
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
                  {!isError && state === 'question' && <QuestionMark color="#5a2828" opacity={0.7} />}
                  {state === 'cat' && <CatReveal variant={catAnimation} tileColor={bg} />}
                </div>
              )
            })
          )}
        </div>
      </div>
      {holdMenu && <HoldMenu x={holdMenu.x} y={holdMenu.y} hoverOption={holdMenu.hoverOption} />}

      {!isWon && currentStep && (
        <TutorialOverlay
          spotlights={spotlights}
          message={currentStep.message}
          gesture={gesturePrompt}
          onNext={currentStep.kind === 'info' ? () => setStepIndex(i => i + 1) : undefined}
        />
      )}

      {isWon && (
        <div className="phone-fullscreen" style={{
          zIndex: 160,
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
              <div style={{ fontSize: 22, fontWeight: 800, color: '#3a6a40' }}>Tutorial complete!</div>
              <div style={{ fontSize: 15, color: '#7a5040', marginTop: 6 }}>You've got the hang of it.</div>
            </div>
            <button
              onClick={goToLevelOne}
              style={{ background: '#3a8a50', color: 'white', border: 'none', borderRadius: 14, padding: '12px 32px', fontSize: 16, fontWeight: 700, cursor: 'pointer', width: '100%' }}
            >
              Start Level 1 →
            </button>
            <button
              onClick={goToLevels}
              style={{ background: 'none', border: 'none', color: '#a07060', fontSize: 14, cursor: 'pointer', padding: 0 }}
            >
              Back to levels
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
