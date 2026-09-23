import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { useGameStore } from '../store/gameStore.ts'
import type { CellState, Difficulty } from '../store/gameStore.ts'
import { TUTORIAL_LEVEL } from '../lib/tutorialLevel'
import { useGridSize } from '../hooks/useGridSize'
import { useBoardGestures } from '../hooks/useBoardGestures'
import { getContainerRect } from '../lib/containerRect.ts'
import { getHint, type Hint, type HintPart } from '../lib/levelGen'
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
  // Omitted for multi-cell steps, where a single pulsing icon wouldn't point
  // at anything meaningful — the spotlight ring on every target cell is cue
  // enough.
  gesture?: { kind: GesturePrompt['kind']; r: number; c: number }
  isComplete: (board: CellState[][]) => boolean
}

type TutorialStep = InfoStep | ActionStep

function uniqueCells(cells: { r: number; c: number }[]): { r: number; c: number }[] {
  const byKey = new Map<string, { r: number; c: number }>()
  cells.forEach(cell => byKey.set(`${cell.r},${cell.c}`, cell))
  return Array.from(byKey.values())
}

// The recap step's "safe to X" set: the first cat's region, row, and column,
// plus the one cell diagonally touching it that none of those three cover —
// everything the no-touch/one-per rules rule out, minus the cat cell itself.
const RECAP_HIGHLIGHT: Highlight[] = [
  { type: 'region', regionId: 0 },
  { type: 'row', r: 1 },
  { type: 'col', c: 0 },
  { type: 'cell', r: 2, c: 1 },
]
const RECAP_TARGET_CELLS = uniqueCells(RECAP_HIGHLIGHT.flatMap(cellsForHighlight))
  .filter(({ r, c }) => !(r === 1 && c === 0))

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
      kind: 'action',
      message: "That cat fills its region, row, and column, plus cats can't touch diagonally. Tap the glowing cells to mark them X! 🙀",
      highlight: RECAP_HIGHLIGHT,
      isComplete: board => RECAP_TARGET_CELLS.every(({ r, c }) => board[r][c] === 'marker'),
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
  const [hint, setHint] = useState<Hint | null>(null)

  const isWon = solvedRegions.size === SIZE
  // The last step is an info bubble ("Your turn!") with no highlight/gesture —
  // once it's dismissed, currentStep is null and the player is solving
  // unaided. That's the only point hints make sense; earlier steps already
  // spotlight exactly what to do.
  const isFreeSolve = !currentStep && !isWon

  const requestHint = useCallback(() => {
    const marked = new Set<number>()
    board.forEach((row, r) => row.forEach((cell, c) => { if (cell === 'marker') marked.add(r * SIZE + c) }))
    const h = getHint(TUTORIAL_LEVEL, solvedRegions, marked)
    setHint(h ?? { parts: [{ type: 'text', text: 'No hint available right now.' }] })
  }, [board, solvedRegions])

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
  const isCellLocked = useCallback((r: number, c: number) => boardRef.current[r][c] === 'cat', [])

  const setCellState = useCallback((r: number, c: number, state: Exclude<CellState, 'cat'>) => {
    updateBoard(prev => {
      const next = prev.map(row => [...row]) as CellState[][]
      next[r][c] = state
      return next
    })
  }, [updateBoard])

  // This is a guided demo on a fixed puzzle, not the real game — there's
  // nothing to fail here. An incorrect guess is simply ignored rather than
  // flashing red and locking the cell, so nothing "wrong" can ever happen.
  const attemptCat = useCallback((r: number, c: number) => {
    if (boardRef.current[r][c] === 'cat') return
    const regionId = TUTORIAL_LEVEL.regions[r][c]
    const sol = TUTORIAL_LEVEL.solution[regionId]
    if (sol.r !== r || sol.c !== c) return

    updateBoard(prev => {
      const next = prev.map(row => [...row]) as CellState[][]
      next[r][c] = 'cat'
      return next
    })
    setSolvedRegions(prev => new Set([...prev, regionId]))
  }, [updateBoard])

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

  // Measuring gridRef during render reads whatever the DOM looked like
  // *before* this render commits, not after — normally invisible, but the
  // message panel below now sits in normal layout flow instead of floating
  // fixed over the grid, so its height (which varies per step) changes how
  // much room the grid gets on every step change. Measuring here would then
  // read the grid's size from just before that resize, one render behind
  // where it actually ends up — a persistent, not just one-frame, offset.
  // useLayoutEffect runs after the DOM is committed, so this reads the real,
  // final position.
  const [spotlights, setSpotlights] = useState<SpotlightRect[]>([])
  const [gesturePrompt, setGesturePrompt] = useState<GesturePrompt | undefined>(undefined)

  useLayoutEffect(() => {
    if (isWon || !currentStep) {
      setSpotlights([])
      setGesturePrompt(undefined)
      return
    }
    setSpotlights(
      currentStep.highlight
        ? currentStep.highlight.flatMap(cellsForHighlight).map(({ r, c }) => getCellRect(r, c)).filter((r): r is SpotlightRect => r !== null)
        : []
    )
    if (currentStep.kind === 'action' && currentStep.gesture) {
      const rect = getCellRect(currentStep.gesture.r, currentStep.gesture.c)
      setGesturePrompt(rect ? { kind: currentStep.gesture.kind, x: rect.x + rect.width / 2, y: rect.y + rect.height / 2 } : undefined)
    } else {
      setGesturePrompt(undefined)
    }
  }, [isWon, currentStep, gridSize, getCellRect])

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
                  {state === 'marker' && <XMark color="#462323" opacity={0.6} />}
                  {state === 'question' && <QuestionMark color="#5a2828" opacity={0.7} />}
                  {state === 'cat' && <CatReveal variant={catAnimation} tileColor={bg} />}
                </div>
              )
            })
          )}
        </div>
      </div>
      {holdMenu && <HoldMenu x={holdMenu.x} y={holdMenu.y} hoverOption={holdMenu.hoverOption} />}

      {!isWon && currentStep && <TutorialOverlay spotlights={spotlights} gesture={gesturePrompt} />}

      {/* In normal flow (not a fixed overlay) so it takes real layout space —
          the grid above shrinks to fit, instead of this panel floating over
          and covering cells an action step might ask the player to tap. */}
      {!isWon && currentStep && (
        <div style={{
          flexShrink: 0, margin: '0 0 12px', zIndex: 153,
          background: '#fffaf5', borderRadius: 16, padding: '14px 16px',
          boxShadow: '0 6px 24px rgba(0,0,0,0.3)',
          display: 'flex', flexDirection: 'column', gap: 10,
        }}>
          <p style={{ margin: 0, fontSize: 14, lineHeight: 1.5, color: '#5a2828', fontWeight: 500 }}>
            {currentStep.message}
          </p>
          {currentStep.kind === 'info' && (
            <button
              onClick={() => setStepIndex(i => i + 1)}
              style={{
                alignSelf: 'flex-end', background: '#3a8a50', color: 'white', border: 'none',
                borderRadius: 10, padding: '8px 18px', fontSize: 13, fontWeight: 700, cursor: 'pointer',
              }}
            >
              Got it →
            </button>
          )}
        </div>
      )}

      {isFreeSolve && (
        <div style={{ display: 'flex', justifyContent: 'center', padding: '0 0 16px', flexShrink: 0 }}>
          <button
            title="Hint"
            onClick={requestHint}
            style={{ width: 56, height: 56, borderRadius: '50%', background: 'white', border: 'none', boxShadow: '0 2px 12px rgba(0,0,0,0.15)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 26, cursor: 'pointer' }}
          >
            💡
          </button>
        </div>
      )}

      {isFreeSolve && hint && (
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
                    backgroundColor: TUTORIAL_LEVEL.colors[part.regionId],
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
