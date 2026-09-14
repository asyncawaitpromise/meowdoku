import { describe, it, expect } from 'vitest'
import fs from 'fs'
import { encodeShareCode, decodeShareCode } from '../../client/src/lib/levelGen/share'

interface FixturePuzzle { label: string; size: number; regions: number[][]; solution: { r: number; c: number }[] }
const fixture = JSON.parse(
  fs.readFileSync('test/fixtures/generated-cache/latest.json', 'utf8')
) as { puzzles: FixturePuzzle[] }

// Two labelings are the same puzzle iff they agree on which cells share a
// region — the codec is free to relabel regions as long as the partition
// (and therefore the solution) comes out identical.
function toCanonicalRGS(regions: number[][], N: number): number[] {
  const map = new Map<number, number>()
  const out: number[] = []
  for (let r = 0; r < N; r++) {
    for (let c = 0; c < N; c++) {
      const orig = regions[r][c]
      let label = map.get(orig)
      if (label === undefined) { label = map.size; map.set(orig, label) }
      out.push(label)
    }
  }
  return out
}

function sameSolutionSet(a: { r: number; c: number }[], b: { r: number; c: number }[]): boolean {
  const key = (s: { r: number; c: number }) => s.r * 1000 + s.c
  const sa = [...a].map(key).sort((x, y) => x - y)
  const sb = [...b].map(key).sort((x, y) => x - y)
  return sa.length === sb.length && sa.every((v, i) => v === sb[i])
}

describe('encodeShareCode / decodeShareCode', () => {
  it('round-trips every real generated puzzle in the fixture set', () => {
    for (const p of fixture.puzzles) {
      const level = { size: p.size, regions: p.regions, solution: p.solution } as any
      const code = encodeShareCode(level)
      const decoded = decodeShareCode(code)
      expect(decoded, `failed to decode ${p.label}`).not.toBeNull()
      expect(toCanonicalRGS(decoded!.regions, p.size)).toEqual(toCanonicalRGS(p.regions, p.size))
      expect(sameSolutionSet(decoded!.solution, p.solution)).toBe(true)
    }
  })

  it('produces short "f"-prefixed codes, not the old "mwd1." format', () => {
    const p = fixture.puzzles[0]
    const code = encodeShareCode({ size: p.size, regions: p.regions, solution: p.solution } as any)
    expect(code[0]).toBe('f')
    expect(code.startsWith('mwd1.')).toBe(false)
  })

  it('still decodes old "mwd1."-format links (backward compatibility)', () => {
    // A real v1 code, captured from the old encoder before the v2 switch.
    const legacyCode = 'mwd1.6.003221033321003224333334344444444554.153024.0123456789a'
    const decoded = decodeShareCode(legacyCode)
    expect(decoded).not.toBeNull()
    expect(decoded!.size).toBe(6)
    expect(decoded!.regions[0][0]).toBe(0)
  })

  it('rejects garbage input from either codec without throwing', () => {
    expect(decodeShareCode('not a real code')).toBeNull()
    expect(decodeShareCode('mwd1.garbage')).toBeNull()
    expect(decodeShareCode('f!!!not-base62')).toBeNull()
    expect(decodeShareCode('')).toBeNull()
  })

  it('rejects a v2 code whose boundary bits do not form exactly N regions', () => {
    // All-zero bits (i.e. "everything is one region") for an N that expects
    // several regions — union-find collapses to 1 component, not N.
    expect(decodeShareCode('f' + '0'.repeat(1))).toBeNull()
  })
})
