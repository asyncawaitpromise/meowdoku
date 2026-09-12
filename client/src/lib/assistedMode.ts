import type { GeneratedLevel } from './levelGen'

export interface AssistedRules {
  adjacent: boolean
  rowCol: boolean
  color: boolean
}

export const defaultAssistedRules: AssistedRules = { adjacent: true, rowCol: true, color: true }

export const anyAssistedRuleOn = (rules: AssistedRules) => rules.adjacent || rules.rowCol || rules.color

// Cells that can be safely X'd out once a cat lands at (r, c) in region
// `regionId`, per whichever rules are enabled. Pure geometry off the region
// map — no solver/solution involvement — so it's identical whether the board
// is single-player or a shared multiplayer one.
export function collectAssistedCells(
  level: GeneratedLevel,
  r: number,
  c: number,
  regionId: number,
  rules: AssistedRules,
): Array<{ r: number; c: number }> {
  const size = level.size
  const seen = new Set<number>()
  const out: Array<{ r: number; c: number }> = []
  const add = (rr: number, cc: number) => {
    if (rr < 0 || cc < 0 || rr >= size || cc >= size) return
    if (rr === r && cc === c) return
    const key = rr * size + cc
    if (seen.has(key)) return
    seen.add(key)
    out.push({ r: rr, c: cc })
  }

  if (rules.adjacent) {
    for (let dr = -1; dr <= 1; dr++) {
      for (let dc = -1; dc <= 1; dc++) add(r + dr, c + dc)
    }
  }
  if (rules.rowCol) {
    for (let cc = 0; cc < size; cc++) add(r, cc)
    for (let rr = 0; rr < size; rr++) add(rr, c)
  }
  if (rules.color) {
    for (let rr = 0; rr < size; rr++) {
      for (let cc = 0; cc < size; cc++) {
        if (level.regions[rr][cc] === regionId) add(rr, cc)
      }
    }
  }

  return out
}
