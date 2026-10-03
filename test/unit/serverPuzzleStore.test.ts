import { describe, it, expect, vi, beforeEach } from 'vitest'
import { generateLevel, encodeShareCode } from '../../client/src/lib/levelGen/index'

const api = vi.hoisted(() => ({ get: vi.fn() }))
const auth = vi.hoisted(() => ({ userId: 'u1' as string | null }))
vi.mock('../../client/src/services/apiClient.ts', () => ({ apiClient: { get: (...a: unknown[]) => api.get(...a) } }))
vi.mock('../../client/src/store/authStore.ts', () => ({ useAuthStore: { getState: () => ({ user: auth.userId ? { id: auth.userId } : null }) } }))

const store = await import('../../client/src/lib/serverPuzzleStore')

const codesOf = (n: number, seedBase = 1) => Array.from({ length: n }, (_, i) => encodeShareCode(generateLevel(2, seedBase + i)))
const page = (codes: string[], extra: Partial<{ cursor: number; since: number; exhausted: boolean }> = {}) =>
  ({ puzzles: codes.map((shareCode, i) => ({ id: `id${i}`, shareCode })), cursor: 100, since: 7, exhausted: false, ...extra })
const urlOf = (call: number) => String(api.get.mock.calls[call][0])

beforeEach(() => {
  api.get.mockReset()
  auth.userId = 'u1'
  store.__resetStoreCacheForTests()
})

describe('device puzzle cache', () => {
  it('fetches a batch when empty, hands out a puzzle, and keeps the rest', async () => {
    const codes = codesOf(8)
    api.get.mockResolvedValue(page(codes))
    const level = await store.getStorePuzzle('expert')
    expect(level).not.toBeNull()
    expect(String(api.get.mock.calls[0][0])).toMatch(/^\/api\/puzzle-catalog\/batch\?difficulty=expert&limit=20&cursor=-1&since=0$/)
    expect(store.cachedPuzzleCount('expert')).toBe(7)
    // later puzzles come straight from the cache: no further request while there is plenty left
    await store.getStorePuzzle('expert')
    expect(api.get).toHaveBeenCalledTimes(1)
  })

  it('remembers where it got to: the next request carries the cursor and since the server returned', async () => {
    api.get.mockResolvedValueOnce(page(codesOf(3), { cursor: 4242, since: 99 }))
    api.get.mockResolvedValue(page(codesOf(3, 50), { cursor: 5000, since: 100 }))
    await store.getStorePuzzle('hard')              // empty -> fetch (3 codes, 2 left after the pop => below LOW_WATER -> quiet top-up)
    await vi.waitFor(() => expect(api.get).toHaveBeenCalledTimes(2))
    expect(urlOf(1)).toContain('cursor=4242')
    expect(urlOf(1)).toContain('since=99')
  })

  it('quietly tops up in the background when the queue runs low, without making the player wait', async () => {
    api.get.mockResolvedValueOnce(page(codesOf(store.LOW_WATER + 1)))
    api.get.mockImplementationOnce(() => new Promise(() => {}))   // the top-up never answers
    const level = await store.getStorePuzzle('hard')              // pops one -> exactly LOW_WATER left? (LOW_WATER+1 -1)
    expect(level).not.toBeNull()
    expect(api.get).toHaveBeenCalledTimes(1)                      // at LOW_WATER: not low yet
    await store.getStorePuzzle('hard')                             // now LOW_WATER-1 left -> top-up fires, hangs, but we still got a puzzle
    expect(api.get).toHaveBeenCalledTimes(2)
  })

  it('keeps working offline from what it already has, then returns null once empty', async () => {
    api.get.mockResolvedValueOnce(page(codesOf(2), { exhausted: true }))
    expect(await store.getStorePuzzle('hard')).not.toBeNull()
    api.get.mockRejectedValue(new Error('Failed to fetch'))
    expect(await store.getStorePuzzle('hard')).not.toBeNull()     // second cached puzzle, no network needed
    expect(await store.getStorePuzzle('hard')).toBeNull()         // empty and offline: caller falls back
  })

  it('never calls the server for tiers without a store, or when signed out', async () => {
    expect(await store.getStorePuzzle('easy')).toBeNull()
    expect(await store.getStorePuzzle('medium')).toBeNull()
    auth.userId = null
    expect(await store.getStorePuzzle('expert')).toBeNull()
    expect(api.get).not.toHaveBeenCalled()
  })

  it('skips codes that do not decode', async () => {
    api.get.mockResolvedValue(page(['f!!bad!!', ...codesOf(2)]))
    expect(await store.getStorePuzzle('hard')).not.toBeNull()
  })

  it('coalesces concurrent refills into one request', async () => {
    let resolve!: (v: unknown) => void
    api.get.mockReturnValue(new Promise(r => { resolve = r }))
    const a = store.refillStore('hard'), b = store.refillStore('hard'), c = store.refillStore('hard')
    resolve(page(codesOf(4)))
    expect(await Promise.all([a, b, c])).toEqual([4, 4, 4])
    expect(api.get).toHaveBeenCalledTimes(1)
  })

  it('gives up after the timeout instead of hanging', async () => {
    api.get.mockImplementation(() => new Promise(() => {}))
    const t0 = Date.now()
    expect(await store.getStorePuzzle('hard', 40)).toBeNull()
    expect(Date.now() - t0).toBeLessThan(2000)
  })

  it('does not hammer the server once it says there is nothing more for this player', async () => {
    api.get.mockResolvedValue(page([], { exhausted: true }))
    expect(await store.refillStore('expert')).toBe(0)
    expect(await store.refillStore('expert')).toBe(0)
    expect(await store.refillStore('expert')).toBe(0)
    expect(api.get).toHaveBeenCalledTimes(1)
  })

  it('keeps a separate queue and cursor per signed-in user', async () => {
    api.get.mockResolvedValue(page(codesOf(3)))
    await store.refillStore('hard')
    expect(store.cachedPuzzleCount('hard')).toBe(3)
    auth.userId = 'u2'
    expect(store.cachedPuzzleCount('hard')).toBe(0)
    await store.refillStore('hard')
    expect(urlOf(1)).toContain('cursor=-1')                       // u2 starts from scratch
  })

  it('prefetch fills only the tiers that are running low', async () => {
    api.get.mockResolvedValue(page(codesOf(store.LOW_WATER + 3)))
    await store.refillStore('hard')                               // hard is now comfortably stocked
    api.get.mockClear()
    store.prefetchStorePuzzles()
    await vi.waitFor(() => expect(api.get).toHaveBeenCalledTimes(1))
    expect(urlOf(0)).toContain('difficulty=expert')               // only expert needed topping up
  })
})
