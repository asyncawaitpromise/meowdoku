import { useCallback, useRef, useState } from 'react'
import type { CellState } from '../store/gameStore.ts'
import { HOLD_DURATION_MS, resolveHoldOption, type HoldOption } from '../lib/holdMenuLayout.ts'

export interface HoldMenuState {
  r: number
  c: number
  x: number
  y: number
  hoverOption: HoldOption | null
}

export interface BoardGesturesConfig {
  getCellFromPoint: (clientX: number, clientY: number) => { r: number; c: number } | null
  getCellState: (r: number, c: number) => CellState
  // Cells nothing can act on right now (already correctly solved, or a
  // wrong guess locked showing its X) — no paint, no hold menu.
  isLocked: (r: number, c: number) => boolean
  // Writes an exact target state (never 'cat' — that goes through attemptCat
  // so its win/miss consequences still run).
  setCellState: (r: number, c: number, state: Exclude<CellState, 'cat'>) => void
  attemptCat: (r: number, c: number) => void
  doubleTapEnabled: boolean
  disabled?: () => boolean
}

// Single source of truth for every board pointer gesture: quick tap places an
// X, a second quick tap on the same cell commits a cat (toggleable — see
// doubleTapEnabled), dragging across cells paints/erases a run of Xs, and
// holding still opens a radial picker (cat / X / ?) so an accidental double
// tap can't slip a cat in for someone with less precise fingers. Both
// single-player and multiplayer boards plug their own state-application
// (local setState vs. a network call) into the same gesture logic here.
export function useBoardGestures(config: BoardGesturesConfig) {
  const { getCellFromPoint, getCellState, isLocked, setCellState, attemptCat, doubleTapEnabled, disabled } = config

  const paintMode = useRef<'paint' | 'erase' | null>(null)
  const lastTap = useRef<{ r: number; c: number; time: number } | null>(null)
  const lastPainted = useRef<string | null>(null)

  const holdTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const holdOrigin = useRef<{ r: number; c: number; x: number; y: number } | null>(null)
  const [holdMenu, setHoldMenu] = useState<HoldMenuState | null>(null)
  const holdMenuRef = useRef<HoldMenuState | null>(null)

  const clearHold = useCallback(() => {
    if (holdTimer.current) clearTimeout(holdTimer.current)
    holdTimer.current = null
    holdOrigin.current = null
    holdMenuRef.current = null
    setHoldMenu(null)
  }, [])

  const handlePointerDown = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
    if (disabled?.()) return
    const cell = getCellFromPoint(e.clientX, e.clientY)
    if (!cell) return
    const { r, c } = cell
    if (isLocked(r, c)) {
      paintMode.current = null
      return
    }
    const now = Date.now()
    const lt = lastTap.current

    if (doubleTapEnabled && lt && lt.r === r && lt.c === c && now - lt.time < 300) {
      lastTap.current = null
      paintMode.current = null
      clearHold()
      attemptCat(r, c)
      return
    }

    lastTap.current = { r, c, time: now }
    lastPainted.current = `${r},${c}`
    // Best-effort: some browsers (older WebKit, some hardened Chromium
    // forks) can throw here for a pointerId they otherwise handle fine for
    // move/up — an uncaught throw would abort this handler before the
    // marker-placing logic below ever runs, silently breaking every tap.
    try { e.currentTarget.setPointerCapture(e.pointerId) } catch { /* ignore */ }

    const cur = getCellState(r, c)
    if (cur === 'empty') {
      paintMode.current = 'paint'
      setCellState(r, c, 'marker')
    } else if (cur === 'marker' || cur === 'question') {
      paintMode.current = 'erase'
      setCellState(r, c, 'empty')
    } else {
      paintMode.current = null
    }

    holdOrigin.current = { r, c, x: e.clientX, y: e.clientY }
    holdTimer.current = setTimeout(() => {
      // Re-check: a move to another cell or a release/cancel may have
      // already cleared this out before the timer fired.
      const origin = holdOrigin.current
      if (!origin || origin.r !== r || origin.c !== c) return
      paintMode.current = null
      const next: HoldMenuState = { r, c, x: origin.x, y: origin.y, hoverOption: null }
      holdMenuRef.current = next
      setHoldMenu(next)
    }, HOLD_DURATION_MS)
  }, [disabled, getCellFromPoint, isLocked, doubleTapEnabled, attemptCat, getCellState, setCellState, clearHold])

  const handlePointerMove = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
    const openMenu = holdMenuRef.current
    if (openMenu) {
      const option = resolveHoldOption(e.clientX - openMenu.x, e.clientY - openMenu.y)
      if (option !== openMenu.hoverOption) {
        const next = { ...openMenu, hoverOption: option }
        holdMenuRef.current = next
        setHoldMenu(next)
      }
      return
    }

    const cell = getCellFromPoint(e.clientX, e.clientY)

    if (holdOrigin.current && cell && (cell.r !== holdOrigin.current.r || cell.c !== holdOrigin.current.c)) {
      // Left the origin cell before the hold threshold — this is a drag,
      // not a hold. Fall through to ordinary paint-drag below.
      if (holdTimer.current) clearTimeout(holdTimer.current)
      holdTimer.current = null
      holdOrigin.current = null
    }

    if (!paintMode.current || !cell) return
    const { r, c } = cell
    const key = `${r},${c}`
    if (isLocked(r, c)) return
    if (key === lastPainted.current) return
    lastPainted.current = key
    lastTap.current = null

    const cur = getCellState(r, c)
    if (paintMode.current === 'paint' && cur === 'empty') setCellState(r, c, 'marker')
    else if (paintMode.current === 'erase' && (cur === 'marker' || cur === 'question')) setCellState(r, c, 'empty')
  }, [getCellFromPoint, isLocked, getCellState, setCellState])

  const finishGesture = useCallback((commit: boolean) => {
    const menu = holdMenuRef.current
    paintMode.current = null
    lastPainted.current = null
    clearHold()
    if (!commit || !menu || !menu.hoverOption) return
    // On a shared/networked board, a partner may have solved this exact cell
    // (or the wrong-guess path may have locked it) while our hold was still
    // open — re-check right before writing rather than trusting isLocked's
    // reading from pointerdown time. attemptCat already guards this itself.
    if (menu.hoverOption === 'cat') { attemptCat(menu.r, menu.c); return }
    if (isLocked(menu.r, menu.c)) return
    setCellState(menu.r, menu.c, menu.hoverOption === 'x' ? 'marker' : 'question')
  }, [clearHold, attemptCat, setCellState, isLocked])

  const handlePointerUp = useCallback(() => finishGesture(true), [finishGesture])
  // A cancelled gesture (OS-interrupted touch sequence) never commits an
  // in-progress hold-menu pick — intent isn't clear once the OS has stepped in.
  const handlePointerCancel = useCallback(() => finishGesture(false), [finishGesture])
  // setPointerCapture (set in handlePointerDown) keeps delivering move/up to
  // this element by actual pointer position even once the pointer physically
  // strays outside the grid's box — which a hold-menu drag does constantly,
  // since its options sit above the touch point. Only bail out early here for
  // plain paint-dragging (no menu open), where leaving the grid has always
  // meant "stop painting"; a real pointerup or pointercancel still settles
  // an open hold-menu.
  const handlePointerLeave = useCallback(() => {
    if (holdMenuRef.current) return
    finishGesture(false)
  }, [finishGesture])

  return { handlePointerDown, handlePointerMove, handlePointerUp, handlePointerCancel, handlePointerLeave, holdMenu }
}
