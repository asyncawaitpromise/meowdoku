import { parentPort, workerData } from 'node:worker_threads'
import { searchTierOnce, type SearchTier } from '../../client/src/lib/levelGen/search/searchTier'
import type { PoolEntry } from './types'

// Each worker loops over its own disjoint seed stream and posts accepted puzzles to the main
// thread, which dedupes and persists them. The search itself (start layout -> local search ->
// full tier bar, re-verified from the share code) is shared with the on-device fallback in the
// browser, so a puzzle is held to the same bar wherever it was made.
const { tier, workerId, workers, stepsPerStart, seedBase } = workerData as {
  tier: SearchTier; workerId: number; workers: number; stepsPerStart: number; seedBase: number
}

for (let seed = seedBase + workerId; ; seed += workers) {
  const found = searchTierOnce(tier, seed, stepsPerStart)
  parentPort!.postMessage({ type: 'attempt', accepted: found !== null })
  if (!found) continue
  const entry: PoolEntry = {
    code: found.code, tier, size: found.size, seed: found.seed,
    counts: found.profile.counts, required: found.profile.required, pairUse: found.profile.pairUse, rounds: found.profile.rounds,
  }
  parentPort!.postMessage({ type: 'entry', entry })
}
