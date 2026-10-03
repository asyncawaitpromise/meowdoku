import { describe, it, expect, vi, afterEach } from 'vitest'
import { generateLevel, encodeShareCode } from '../../client/src/lib/levelGen/index'
import { canonicalize } from '../../client/src/lib/levelGen/search/localSearch'

const cells = (sol: { r: number; c: number }[]) => sol.map(s => `${s.r},${s.c}`).sort()

afterEach(() => { vi.unstubAllGlobals(); vi.resetModules() })

describe('pregeneratedPool', () => {
  it('parsePool keeps share codes and drops html / junk lines', async () => {
    const { parsePool } = await import('../../client/src/lib/pregeneratedPool')
    const code = encodeShareCode(generateLevel(2, 1))
    expect(parsePool(`<!doctype html>\n${code}\n\n  ${code}  \nnot a code\n`)).toEqual([code, code])
  })

  it('poolIndex wraps into range, including negative seeds', async () => {
    const { poolIndex } = await import('../../client/src/lib/pregeneratedPool')
    for (const [i, g] of [[0, 0], [5, 3], [123456, 99], [0, -4], [-7, 2]]) {
      const idx = poolIndex(10, i, g)
      expect(idx).toBeGreaterThanOrEqual(0)
      expect(idx).toBeLessThan(10)
    }
    expect(poolIndex(10, 3, 0)).toBe(3)
    expect(poolIndex(10, 13, 0)).toBe(3)
  })

  it('returns the pooled puzzle for hard/expert, deterministically', async () => {
    const levels = [1, 2, 3].map(s => generateLevel(2, s))
    const text = levels.map(encodeShareCode).join('\n') + '\n'
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, text: async () => text })))
    const { getPooledLevel } = await import('../../client/src/lib/pregeneratedPool')
    const a = await getPooledLevel('hard', 4, 0)   // 4 % 3 = 1
    const b = await getPooledLevel('hard', 4, 0)
    expect(a).not.toBeNull()
    expect(a!.regions).toEqual(canonicalize(levels[1].regions, levels[1].size))   // decode relabels canonically
    expect(b!.colors).toEqual(a!.colors)           // co-op: both devices see the same board
    expect(cells(a!.solution)).toEqual(cells(levels[1].solution))
  })

  it('returns null for tiers without a pool and never fetches for them', async () => {
    const f = vi.fn()
    vi.stubGlobal('fetch', f)
    const { getPooledLevel } = await import('../../client/src/lib/pregeneratedPool')
    expect(await getPooledLevel('easy', 0, 0)).toBeNull()
    expect(await getPooledLevel('medium', 0, 0)).toBeNull()
    expect(f).not.toHaveBeenCalled()
  })

  it('falls back to null on a network error, a 404, or an html fallback page', async () => {
    for (const impl of [
      async () => { throw new Error('offline') },
      async () => ({ ok: false, text: async () => '' }),
      async () => ({ ok: true, text: async () => '<!doctype html><html></html>' }),
    ]) {
      vi.stubGlobal('fetch', vi.fn(impl))
      vi.resetModules()
      const { getPooledLevel } = await import('../../client/src/lib/pregeneratedPool')
      expect(await getPooledLevel('expert', 0, 0)).toBeNull()
    }
  })
})
