import { useCallback, useEffect, useRef } from 'react'
import type { GeneratedLevel } from '../lib/levelGen'
import { collectAssistedCells, type AssistedRules } from '../lib/assistedMode'

const STAGGER_MS = 55

// Places assisted-mode X's one at a time, like a little cascade, instead of
// all at once — but on independent timers, so it never blocks the player
// from continuing to place cats while it plays out. `isMarkable` is
// re-checked at each cell's own turn (not computed up front) since the board
// can change during the stagger.
export function useAssistedMarks(
  level: GeneratedLevel | null,
  enabled: boolean,
  rules: AssistedRules,
  isMarkable: (r: number, c: number) => boolean,
  applyMark: (r: number, c: number) => void,
) {
  const timers = useRef<Set<ReturnType<typeof setTimeout>>>(new Set())

  useEffect(() => () => {
    timers.current.forEach(clearTimeout)
    timers.current.clear()
  }, [])

  return useCallback((r: number, c: number, regionId: number) => {
    if (!enabled || !level) return
    const cells = collectAssistedCells(level, r, c, regionId, rules)
    cells.forEach(({ r: rr, c: cc }, i) => {
      const t = setTimeout(() => {
        timers.current.delete(t)
        if (isMarkable(rr, cc)) applyMark(rr, cc)
      }, (i + 1) * STAGGER_MS)
      timers.current.add(t)
    })
  }, [enabled, level, rules, isMarkable, applyMark])
}
