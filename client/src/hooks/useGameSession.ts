import { useState, useRef, useCallback, useEffect, type RefObject } from 'react'
import { useGameStore } from '../store/gameStore.ts'
import type { Difficulty, CellState } from '../store/gameStore.ts'
import { getHint, encodeShareCode, decodeShareCode, type GeneratedLevel, type Hint } from '../lib/levelGen'
import { runLevelGeneration } from '../lib/levelGenCoordinator'
import { logPuzzleDebug } from '../lib/logPuzzleDebug'

const GRID_PAD = 8
const GRID_GAP = 3
const MAX_FISH = 3

const makeEmpty = (n: number): CellState[][] =>
  Array.from({ length: n }, () => Array<CellState>(n).fill('empty'))

export interface GameIdentity {
  gameId: string
  levelNum: number
  puzzleSeed: number
  isDifficultyMode: boolean
  difficulty: Difficulty
  puzzleIndex: number
  isSharedMode: boolean
  codeParam: string | undefined
  // Head-to-head match play reuses this hook for its own local board but
  // shouldn't feed a match's throwaway puzzleIndex/levelNum into single-player
  // completion tracking.
  skipProgressTracking?: boolean
  // Match boards are throwaway — nothing about them should be written into the
  // user's saved-games (local or server), even if the match is abandoned.
  skipPersistence?: boolean
}

// Owns every piece of state a game screen needs beyond routing and grid
// sizing: loading or generating the level, the marker/cat board itself, win
// and life tracking, pointer gestures, hints, and sharing. These stay one
// unit rather than several smaller hooks because loading a saved game
// (`restoringRef`) reaches directly into the board state that a fresh
// generation would otherwise reset — splitting them apart would mean
// threading that same flag back across a hook boundary.
export function useGameSession(identity: GameIdentity, gridRef: RefObject<HTMLDivElement>) {
  const {
    gameId, levelNum, puzzleSeed, isDifficultyMode, difficulty, puzzleIndex, isSharedMode, codeParam,
    skipProgressTracking, skipPersistence,
  } = identity
  const { setLastLevel, markLevelComplete, markPuzzleComplete, saveGame, loadGame, clearSavedGame, cacheLevel, getCachedLevel } = useGameStore()

  useEffect(() => {
    if (!isDifficultyMode && !isSharedMode) setLastLevel(levelNum)
  }, [levelNum, isDifficultyMode, isSharedMode, setLastLevel])

  // Load a level: restore an in-progress game if one was saved, otherwise
  // generate it fresh in a Web Worker so the loading state stays responsive.
  const [level, setLevel] = useState<GeneratedLevel | null>(null)
  const [genStatus, setGenStatus] = useState<string[]>([])
  const [shareError, setShareError] = useState(false)
  const restoringRef = useRef(false)
  useEffect(() => {
    setShareError(false)
    const saved = loadGame(gameId)
    if (saved) {
      restoringRef.current = true
      setGenStatus([])
      setLevel(saved.level)
      boardRef.current = saved.board
      setBoard(saved.board)
      setSolvedRegions(new Set(saved.solvedRegions))
      setFishCount(saved.fishCount)
      setWrongCells(new Set(saved.wrongCells))
      wrongCellsRef.current = new Set(saved.wrongCells)
      setErrorCell(null)
      setHint(null)
      return
    }

    restoringRef.current = false
    setLevel(null)
    setGenStatus([])

    // A previously-generated puzzle (e.g. one already completed, whose saved
    // in-progress board was cleared on win) doesn't need to be regenerated —
    // reuse the cached level and just start with a fresh board.
    const cached = getCachedLevel(gameId)
    if (cached) {
      setLevel(cached)
      return
    }

    // Shared puzzles are fully specified by the code itself — decode it
    // in-thread instead of generating (there's nothing to search for).
    if (isSharedMode) {
      const decoded = codeParam ? decodeShareCode(codeParam) : null
      if (!decoded) { setShareError(true); return }
      cacheLevel(gameId, decoded)
      setLevel(decoded)
      return
    }

    const cancel = runLevelGeneration(
      isDifficultyMode
        ? { type: 'generateLevelByDifficulty', difficulty, puzzleIndex, globalSeed: puzzleSeed }
        : { type: 'generateLevel', levelNum, puzzleSeed },
      (statuses) => setGenStatus(statuses),
      (lvl) => {
        logPuzzleDebug(lvl, isDifficultyMode
          ? { mode: 'difficulty', difficulty, puzzleIndex, globalSeed: puzzleSeed }
          : { mode: 'level', levelNum, puzzleSeed })
        cacheLevel(gameId, lvl)
        setLevel(lvl)
      },
    )
    return cancel
  }, [gameId, levelNum, puzzleSeed, isDifficultyMode, difficulty, puzzleIndex, isSharedMode, codeParam, loadGame, getCachedLevel, cacheLevel])

  // ── Board state ──────────────────────────────────────────────────────────
  const [board, setBoard] = useState<CellState[][]>([])
  const boardRef = useRef(board)

  const [solvedRegions, setSolvedRegions] = useState<Set<number>>(new Set())
  const [fishCount, setFishCount] = useState(MAX_FISH)
  const [errorCell, setErrorCell] = useState<{ r: number; c: number } | null>(null)
  const [wrongCells, setWrongCells] = useState<Set<string>>(new Set())
  const wrongCellsRef = useRef(wrongCells)
  const errorTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  const [hint, setHint] = useState<Hint | null>(null)

  const isWon = !!level && solvedRegions.size === level.size
  const isGameOver = fishCount === 0 && !isWon

  const [showWinModal, setShowWinModal] = useState(false)

  useEffect(() => {
    if (isWon) {
      if (!skipProgressTracking) {
        if (isDifficultyMode) markPuzzleComplete(difficulty, puzzleIndex)
        else if (!isSharedMode) markLevelComplete(levelNum)
      }
      setShowWinModal(true)
    }
  }, [isWon]) // eslint-disable-line react-hooks/exhaustive-deps

  // Reset board whenever a freshly generated level arrives (covers both the
  // levelNum/puzzleIndex-change case, since that always routes through a new
  // `level` via the generation effect above, and any regeneration). Gated on
  // `level` being present so the board is always sized to level.size — never
  // resets to a stale size while a puzzle is still generating.
  const [leavingMarkers, setLeavingMarkers] = useState<Set<string>>(new Set())
  const leavingTimers = useRef<Map<string, ReturnType<typeof setTimeout>>>(new Map())

  useEffect(() => {
    if (!level) return
    // When the level was restored from saved progress, the board state was
    // already hydrated by the load effect — don't wipe it here.
    if (restoringRef.current) {
      restoringRef.current = false
      return
    }
    if (errorTimer.current) clearTimeout(errorTimer.current)
    const b = makeEmpty(level.size)
    boardRef.current = b
    setBoard(b)
    setSolvedRegions(new Set())
    setFishCount(MAX_FISH)
    setErrorCell(null)
    setWrongCells(new Set())
    wrongCellsRef.current = new Set()
    setHint(null)
    setShowWinModal(false)
    leavingTimers.current.forEach(clearTimeout)
    leavingTimers.current.clear()
    setLeavingMarkers(new Set())
  }, [level])

  useEffect(() => () => { if (errorTimer.current) clearTimeout(errorTimer.current) }, [])

  // Persist in-progress games so returning to this puzzle restores it instead
  // of regenerating. A win clears the saved snapshot. Match play opts out
  // entirely — its boards are throwaway.
  useEffect(() => {
    if (skipPersistence) return
    if (!level || board.length !== level.size) return
    if (isWon) {
      clearSavedGame(gameId)
      return
    }
    saveGame(gameId, {
      level,
      board,
      solvedRegions: Array.from(solvedRegions),
      fishCount,
      wrongCells: Array.from(wrongCells),
    })
  }, [level, board, solvedRegions, fishCount, wrongCells, isWon, gameId, saveGame, clearSavedGame, skipPersistence])

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

  const removeMarker = useCallback((r: number, c: number) => {
    const key = `${r},${c}`
    updateBoard(prev => {
      const next = prev.map(row => [...row]) as CellState[][]
      next[r][c] = 'empty'
      return next
    })
    setLeavingMarkers(prev => new Set([...prev, key]))
    setWrongCells(prev => { const s = new Set(prev); s.delete(key); return s })
    wrongCellsRef.current = new Set(wrongCellsRef.current)
    wrongCellsRef.current.delete(key)
    if (leavingTimers.current.has(key)) clearTimeout(leavingTimers.current.get(key)!)
    const t = setTimeout(() => {
      setLeavingMarkers(prev => { const s = new Set(prev); s.delete(key); return s })
      leavingTimers.current.delete(key)
    }, 220)
    leavingTimers.current.set(key, t)
  }, [updateBoard])

  // Cancels a cell's still-playing X exit animation. Needed when a cat lands
  // in a cell whose marker was just erased — otherwise the fading X keeps
  // rendering on top of the new cat for the rest of its 220ms exit.
  const cancelLeavingMarker = useCallback((r: number, c: number) => {
    const key = `${r},${c}`
    if (leavingTimers.current.has(key)) {
      clearTimeout(leavingTimers.current.get(key)!)
      leavingTimers.current.delete(key)
      setLeavingMarkers(prev => { const s = new Set(prev); s.delete(key); return s })
    }
  }, [])

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

  // ── Cat placement / validation ───────────────────────────────────────────
  const attemptPlace = useCallback((r: number, c: number) => {
    if (isWon || isGameOver || !level) return
    if (wrongCellsRef.current.has(`${r},${c}`)) return
    const cur = boardRef.current[r][c]

    if (cur === 'cat') {
      // Correctly placed cats are permanent — no undo.
      return
    }

    const regionId = level.regions[r][c]
    const sol = level.solution[regionId]

    if (sol.r === r && sol.c === c) {
      // ✓ Correct
      cancelLeavingMarker(r, c)
      updateBoard(prev => {
        const next = prev.map(row => [...row]) as CellState[][]
        next[r][c] = 'cat'
        return next
      })
      setSolvedRegions(prev => new Set([...prev, regionId]))
    } else {
      // ✗ Wrong — flash error, deduct fish, lock the cell showing a static X.
      // Always force the board state to 'marker' here: `cur` may be 'empty'
      // (e.g. the first tap of a double-tap gesture just erased a pre-existing
      // marker via the toggle logic before this second tap landed), and
      // without this the cell would end up in wrongCells with no marker to
      // render — an invisible, permanently-locked cell.
      if (errorTimer.current) clearTimeout(errorTimer.current)
      cancelLeavingMarker(r, c)
      setFishCount(prev => Math.max(0, prev - 1))
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
  }, [isWon, isGameOver, level, updateBoard, cancelLeavingMarker])

  // ── Pointer handlers ─────────────────────────────────────────────────────
  const handlePointerDown = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
    const cell = getCellFromPoint(e.clientX, e.clientY)
    if (!cell) return
    const { r, c } = cell
    if (wrongCellsRef.current.has(`${r},${c}`)) {
      paintMode.current = null
      return
    }
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
    if (wrongCellsRef.current.has(key)) return
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

  // Copies a link encoding this exact puzzle (regions + solution, not progress)
  // so it can be pasted anywhere — a text message, chat, etc. — and opening it
  // loads the identical puzzle via decodeShareCode above, no account needed.
  const [shareCopied, setShareCopied] = useState(false)
  const shareCopiedTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const handleShare = useCallback(() => {
    if (!level) return
    const url = `${window.location.origin}/shared/${encodeShareCode(level)}`
    navigator.clipboard.writeText(url).then(() => {
      setShareCopied(true)
      if (shareCopiedTimer.current) clearTimeout(shareCopiedTimer.current)
      shareCopiedTimer.current = setTimeout(() => setShareCopied(false), 1800)
    }).catch(() => {
      window.prompt('Copy this link to share the puzzle:', url)
    })
  }, [level])
  useEffect(() => () => { if (shareCopiedTimer.current) clearTimeout(shareCopiedTimer.current) }, [])

  const reset = useCallback(() => {
    if (!level) return
    if (errorTimer.current) clearTimeout(errorTimer.current)
    const b = makeEmpty(level.size)
    boardRef.current = b
    setBoard(b)
    setSolvedRegions(new Set())
    setFishCount(MAX_FISH)
    setErrorCell(null)
    setWrongCells(new Set())
    wrongCellsRef.current = new Set()
    paintMode.current = null
    lastTap.current = null
    lastPainted.current = null
    leavingTimers.current.forEach(clearTimeout)
    leavingTimers.current.clear()
    setLeavingMarkers(new Set())
  }, [level])

  const requestHint = useCallback(() => {
    if (!level) return
    const marked = new Set<number>()
    board.forEach((row, r) => row.forEach((cell, c) => { if (cell === 'marker') marked.add(r * level.size + c) }))
    const h = getHint(level, solvedRegions, marked)
    setHint(h ?? { parts: [{ type: 'text', text: 'No hint available right now.' }] })
  }, [level, board, solvedRegions])

  return {
    level, genStatus, shareError,
    board, solvedRegions, fishCount, errorCell, wrongCells, leavingMarkers,
    hint, setHint, requestHint,
    isWon, isGameOver, showWinModal, setShowWinModal,
    handlePointerDown, handlePointerMove, handlePointerUp,
    handleShare, shareCopied,
    reset,
  }
}
