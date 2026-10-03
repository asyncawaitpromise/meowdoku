import { describe, it, expect } from 'vitest'
import { existsSync, readFileSync } from 'fs'
import { decodeShareCode, countSolutions, encodeShareCode } from '../../client/src/lib/levelGen/index'
import { profilePuzzle } from '../../client/src/lib/levelGen/solver/profile'
import { TIERS } from '../../client/src/lib/levelGen/search/tiers'
import { parsePool } from '../../client/src/lib/pregeneratedPool'

// Guards the files clients actually download (client/public/puzzles/<tier>.txt,
// written by `pnpm puzzles:publish`): every entry must decode, have exactly one
// solution, and still clear its tier's current bar, with no duplicates. If a
// tier's bar is tightened in search/tiers.ts, re-run puzzles:publish.
describe.each(['hard', 'expert'] as const)('published %s pool', tier => {
  const file = `client/public/puzzles/${tier}.txt`
  const text = existsSync(file) ? readFileSync(file, 'utf-8') : ''
  const codes = parsePool(text)

  it('is non-empty and every line is a share code', () => {
    expect(codes.length).toBeGreaterThan(0)
    expect(codes.length).toBe(text.split('\n').filter(l => l.trim()).length)
  })

  it('has no duplicate puzzles', () => {
    expect(new Set(codes).size).toBe(codes.length)
  })

  it('every puzzle decodes, round-trips, is unique, and clears the tier bar', () => {
    for (const code of codes) {
      const level = decodeShareCode(code)
      expect(level, code).not.toBeNull()
      expect(encodeShareCode(level!)).toBe(code)
      expect(countSolutions(level!.regions, level!.size, 2), code).toBe(1)
      expect(TIERS[tier].layoutAccepts(level!.regions, level!.size), code).toBe(true)
      expect(TIERS[tier].accepts(profilePuzzle(level!.regions, level!.size)), code).toBe(true)
    }
  }, 120_000)
})
