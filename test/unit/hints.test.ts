import { describe, it, expect } from 'vitest'
import { readFileSync } from 'fs'
import { getHint, decodeShareCode, generateLevel } from '../../client/src/lib/levelGen/index'
import type { GeneratedLevel, Hint } from '../../client/src/lib/levelGen/index'

const text = (h: Hint) => h.parts.map(p => (p.type === 'text' ? p.text : `#${p.regionId}`)).join('')
const FALLBACK = 'Look for regions limited'

// A perfect hint-follower: every cell is already crossed out (so each hint's
// elimination is absorbed rather than re-offered), every "only one cell left"
// hint is followed by placing that cat, and then it asks again. It checks that
// (a) the hints never run dry before the puzzle is done — the generic fallback
// text is what a stuck player sees — and (b) every placement hint names the
// real solution cell, which an unsound crossing-out earlier on would break.
function followHints(level: GeneratedLevel) {
  const N = level.size
  const solved = new Set<number>()
  const everything = new Set<number>(Array.from({ length: N * N }, (_, i) => i))
  const kinds = new Set<string>()
  for (let i = 0; i < 4 * N; i++) {
    const hint = getHint(level, solved, everything)
    // null also means "a region ran out of cells", so only a full board counts as done
    if (!hint) return { done: solved.size === N, solved: solved.size, kinds }
    const t = text(hint)
    if (t.startsWith(FALLBACK)) return { done: false, solved: solved.size, kinds }
    const m = t.match(/#(\d+) region has only one possible cell left \(row (\d+), column (\d+)\)/)
    if (!m) return { done: false, solved: solved.size, kinds }
    const reg = Number(m[1])
    expect({ r: Number(m[2]) - 1, c: Number(m[3]) - 1 }).toEqual(level.solution[reg])
    solved.add(reg)
  }
  return { done: false, solved: solved.size, kinds }
}

function loadPool(tier: string): GeneratedLevel[] {
  return readFileSync(`client/public/puzzles/${tier}.txt`, 'utf-8').split('\n').filter(Boolean).map(c => decodeShareCode(c)!)
}

describe('hints on hypothesis-tier puzzles', () => {
  for (const tier of ['hard', 'expert']) {
    it(`${tier}: hints never run dry and only ever point at true cells`, () => {
      for (const level of loadPool(tier)) {
        const r = followHints(level)
        expect(r.done, `stuck after ${r.solved}/${level.size}`).toBe(true)
      }
    }, 120_000)
  }

  it('expert puzzles get what-if hints that target exactly the cell they explain', () => {
    // Cross out everything except one non-solution cell X: the next hint, if any,
    // can only be about X. Scanning X over the board finds the cells that need a
    // hypothesis to eliminate, and shows the hint text a player would get for them.
    let found = 0
    for (const level of loadPool('expert').slice(0, 5)) {
      const N = level.size
      const isSolution = (cell: number) => level.solution.some(s => s.r * N + s.c === cell)
      for (let x = 0; x < N * N && found < 5; x++) {
        if (isSolution(x)) continue
        const marked = new Set<number>(Array.from({ length: N * N }, (_, i) => i).filter(i => i !== x))
        const hint = getHint(level, new Set(), marked)
        if (!hint) continue
        const t = text(hint)
        if (!t.startsWith('What if') && !t.includes('has just two cells left')) continue
        found++
        expect(t).toContain(`row ${Math.floor(x / N) + 1}, column ${(x % N) + 1}`)
        expect(t).toMatch(/cross it out\.$/i)
      }
    }
    expect(found).toBeGreaterThan(0)
  }, 120_000)

  it('still gives the plain hints on an easy puzzle (no regression)', () => {
    const level = generateLevel(2, 3)
    const hint = getHint(level, new Set())
    expect(hint).not.toBeNull()
    expect(text(hint!).startsWith(FALLBACK)).toBe(false)
    const r = followHints(level)
    expect(r.done).toBe(true)
  })
})
