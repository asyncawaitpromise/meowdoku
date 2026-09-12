// Layout constants shared between the gesture hook (hit-testing which option
// a drag has landed on) and the HoldMenu component (rendering the options in
// the same spots) — kept in one place so the two can't drift apart.
export type HoldOption = 'cat' | 'x' | 'question'

export const HOLD_DURATION_MS = 380
export const HOLD_DEADZONE_PX = 22
export const HOLD_OPTION_RADIUS_PX = 62

// Fanned above the touch point (rather than centered under/below it) so a
// player's own finger never covers the options while choosing.
export const HOLD_OPTIONS: { option: HoldOption; ux: number; uy: number }[] = [
  { option: 'x', ux: -0.866, uy: -0.5 },
  { option: 'cat', ux: 0, uy: -1 },
  { option: 'question', ux: 0.866, uy: -0.5 },
]

export function resolveHoldOption(dx: number, dy: number): HoldOption | null {
  const dist = Math.hypot(dx, dy)
  if (dist < HOLD_DEADZONE_PX) return null
  const ux = dx / dist
  const uy = dy / dist
  let best: HoldOption = HOLD_OPTIONS[0].option
  let bestDot = -Infinity
  for (const o of HOLD_OPTIONS) {
    const dot = ux * o.ux + uy * o.uy
    if (dot > bestDot) { bestDot = dot; best = o.option }
  }
  return best
}
