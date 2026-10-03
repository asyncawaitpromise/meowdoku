import { apiClient } from '../services/apiClient.ts'
import { useAuthStore } from '../store/authStore.ts'
import { decodeShareCode, type Difficulty, type GeneratedLevel } from './levelGen'

// The server keeps a store of curated puzzles. This module keeps a small queue of them on
// the device per difficulty, filled in the background, so starting a level is instant and
// still works offline once the queue has been filled.
//
//   - On sign-in / reconnect, `prefetchStorePuzzles` tops every queue up.
//   - `getStorePuzzle` pops the next puzzle; when the queue runs low it quietly asks for more.
//   - If the queue is empty and the server can't be reached, it returns null and the caller
//     falls back to the static pool, then to generating on the device.
//
// The server walks a per-player shuffled order and the device just remembers where it got to:
// `cursor` (position in that order) and `since` (newest puzzle it has been offered, so puzzles
// added since the last visit — which may land behind the cursor — are included). No per-device
// state lives on the server.

// Only the tiers whose on-device generation is slower than a round trip bother with the store.
export const SERVER_STORE_TIERS: ReadonlySet<Difficulty> = new Set<Difficulty>(['hard', 'expert'])

export const BATCH_SIZE = 20
export const LOW_WATER = 5            // top up when fewer than this many are left
export const REQUEST_TIMEOUT_MS = 8000
// When the store says it has nothing more for this player, don't ask again for a while (new
// puzzles arrive with deploys, not by the minute).
export const EXHAUSTED_RETRY_MS = 10 * 60 * 1000

interface TierState { codes: string[]; cursor: number; since: number; exhaustedAt: number }
type CacheState = Partial<Record<Difficulty, TierState>>
interface BatchResponse { puzzles: { id: string; shareCode: string }[]; cursor: number; since: number; exhausted: boolean }

const storageKey = (userId: string) => `meowdoku:puzzleStore:v1:${userId}`
const memory = new Map<string, CacheState>()
const inflight = new Map<string, Promise<number>>()

function load(userId: string): CacheState {
  const key = storageKey(userId)
  const cached = memory.get(key)
  if (cached) return cached
  let state: CacheState = {}
  try {
    const raw = localStorage.getItem(key)
    if (raw) state = JSON.parse(raw) as CacheState
  } catch { /* unavailable or corrupt: start empty */ }
  memory.set(key, state)
  return state
}

function save(userId: string) {
  try { localStorage.setItem(storageKey(userId), JSON.stringify(load(userId))) } catch { /* quota / private mode: memory still works */ }
}

const tier = (userId: string, d: Difficulty): TierState => {
  const state = load(userId)
  return (state[d] ??= { codes: [], cursor: -1, since: 0, exhaustedAt: 0 })
}

const currentUserId = (): string | null => useAuthStore.getState().user?.id ?? null

export function cachedPuzzleCount(difficulty: Difficulty, userId = currentUserId()): number {
  return userId ? tier(userId, difficulty).codes.length : 0
}

// Fetch one more batch for a tier. Resolves with how many puzzles were added; never rejects —
// offline, signed out, timed out and "nothing left" all just add zero.
export function refillStore(difficulty: Difficulty, timeoutMs = REQUEST_TIMEOUT_MS): Promise<number> {
  const userId = currentUserId()
  if (!userId || !SERVER_STORE_TIERS.has(difficulty)) return Promise.resolve(0)
  const key = `${userId}:${difficulty}`
  const running = inflight.get(key)
  if (running) return running

  const t = tier(userId, difficulty)
  if (t.exhaustedAt && Date.now() - t.exhaustedAt < EXHAUSTED_RETRY_MS) return Promise.resolve(0)

  let timer: ReturnType<typeof setTimeout> | undefined
  const timeout = new Promise<null>(resolve => { timer = setTimeout(() => resolve(null), timeoutMs) })
  const request = apiClient
    .get<BatchResponse | null>(`/api/puzzle-catalog/batch?difficulty=${encodeURIComponent(difficulty)}&limit=${BATCH_SIZE}&cursor=${t.cursor}&since=${t.since}`)
    .catch(() => null)

  const job = Promise.race([request, timeout]).then(res => {
    if (!res || !Array.isArray(res.puzzles)) return 0
    const have = new Set(t.codes)
    let added = 0
    for (const p of res.puzzles) {
      if (typeof p.shareCode === 'string' && !have.has(p.shareCode)) { t.codes.push(p.shareCode); have.add(p.shareCode); added++ }
    }
    t.cursor = res.cursor
    t.since = res.since
    t.exhaustedAt = res.exhausted ? Date.now() : 0
    save(userId)
    return added
  }).catch(() => 0).finally(() => {
    if (timer) clearTimeout(timer)
    inflight.delete(key)
  })
  inflight.set(key, job)
  return job
}

// Top up every store tier that is running low. Safe to call as often as you like.
export function prefetchStorePuzzles(): void {
  const userId = currentUserId()
  if (!userId) return
  for (const d of SERVER_STORE_TIERS) if (tier(userId, d).codes.length < LOW_WATER) void refillStore(d)
}

function popDecoded(userId: string, difficulty: Difficulty): GeneratedLevel | null {
  const t = tier(userId, difficulty)
  while (t.codes.length > 0) {
    const code = t.codes.shift()!
    const level = decodeShareCode(code)
    if (level) { save(userId); return level }
  }
  save(userId)
  return null
}

// The next stored puzzle for this tier, or null if there is none to be had right now.
export async function getStorePuzzle(difficulty: Difficulty, waitMs = REQUEST_TIMEOUT_MS): Promise<GeneratedLevel | null> {
  const userId = currentUserId()
  if (!userId || !SERVER_STORE_TIERS.has(difficulty)) return null

  let level = popDecoded(userId, difficulty)
  if (!level) {
    await refillStore(difficulty, waitMs)             // empty: worth waiting for one batch
    level = popDecoded(userId, difficulty)
  }
  if (cachedPuzzleCount(difficulty, userId) < LOW_WATER) void refillStore(difficulty)   // running low: top up quietly
  return level
}

// Test hook: forget in-memory state so a test can start from a clean slate.
export function __resetStoreCacheForTests() { memory.clear(); inflight.clear() }
