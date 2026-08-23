import LevelGenWorker from './levelGen.worker?worker'
import { DIFFICULTY_LEVEL, rankGeneratedLevel } from './levelGen'
import type { GeneratedLevel, Difficulty } from './levelGen'

export type GenRequest =
  | { type: 'generateLevel'; levelNum: number; puzzleSeed: number }
  | { type: 'generateLevelByDifficulty'; difficulty: Difficulty; puzzleIndex: number; globalSeed: number }

// Generation is rejection sampling: each attempt is an independent dice roll,
// and the slow phases (fork-anchored, band-anchored) run thousands of them
// per puzzle. Running WORKER_COUNT independent generateLevel searches at once
// — each seeded with its own salt so they explore uncorrelated random streams
// rather than retreading each other's attempts — multiplies the effective
// attempt rate by WORKER_COUNT, so time-to-first-hit drops roughly linearly.
// Capped at 4: box-of-hardware-threads mobile devices report inflated
// hardwareConcurrency, and generation is bursty enough that going wider
// mostly just burns battery without meaningfully shortening the race.
export const WORKER_COUNT = Math.max(1, Math.min(navigator.hardwareConcurrency || 4, 4))

// Spawns WORKER_COUNT parallel generation workers and races them. The first
// one to return a puzzle that clears its tier's difficulty gate wins outright
// and the rest are cancelled immediately (mirrors generateLevel's own
// early-return phases, just spread across workers instead of one attempt
// loop). If every worker exhausts its search without clearing the gate — the
// same "bestRef" situation a single-threaded run can hit for hard/expert —
// the coordinator picks whichever worker's fallback ranks highest, using the
// exact ranking generateLevel uses internally for its own bestRef.
//
// Returns a cancel function; call it (e.g. on unmount or when the request
// changes) to terminate any still-running workers.
export function runLevelGeneration(
  request: GenRequest,
  onProgress: (statuses: string[]) => void,
  onResult: (level: GeneratedLevel) => void,
): () => void {
  const levelNum = request.type === 'generateLevel' ? request.levelNum : DIFFICULTY_LEVEL[request.difficulty]

  const workers = Array.from({ length: WORKER_COUNT }, () => new LevelGenWorker())
  const results: (GeneratedLevel | null)[] = Array(WORKER_COUNT).fill(null)
  const statuses: string[] = Array(WORKER_COUNT).fill('')
  let doneCount = 0
  let settled = false

  const cleanup = () => { workers.forEach(w => w.terminate()) }

  const finish = (level: GeneratedLevel) => {
    if (settled) return
    settled = true
    onResult(level)
    cleanup()
  }

  workers.forEach((worker, i) => {
    worker.onmessage = (e: MessageEvent<{ type: string; level?: GeneratedLevel; msg?: string }>) => {
      if (settled) return
      if (e.data.type === 'progress') {
        // Each generateLevel call's own progress text describes its own local
        // search ("Searching for a forced-chain puzzle… (attempt 1234/10000)")
        // as if it were the only thing happening — true for a single worker,
        // misleading once WORKER_COUNT independent searches are racing.
        // Report every worker's latest line as its own slot in the array
        // (rather than one line that flips between workers) so the UI can
        // show all of them at once, honestly reflecting that they're
        // concurrent, unrelated searches rather than one search's progress.
        statuses[i] = e.data.msg ?? ''
        onProgress([...statuses])
        return
      }
      const level = e.data.level ?? null
      results[i] = level
      doneCount++
      // gateMet reflects the acceptance decision generateLevel itself already
      // made for this candidate — including phase 0.8's relaxed forcing-chain/
      // branch-rule-only bar for expert, which deliberately skips the full
      // score/step/round/variety gate. Recomputing that gate here instead
      // would reject genuine phase-0.8 hits and stall the race until every
      // worker finishes, every time — see the comment on rankGeneratedLevel.
      if (level && level.gateMet) {
        finish(level)
        return
      }
      if (doneCount === WORKER_COUNT) {
        // No worker landed an outright gate-passing puzzle — fall back to
        // the best-ranked result across all of them, same tie-break logic
        // generateLevel uses for its own single-worker bestRef fallback.
        const best = results.reduce<GeneratedLevel | null>((acc, lvl) => {
          if (!lvl) return acc
          if (!acc || rankGeneratedLevel(levelNum, lvl) > rankGeneratedLevel(levelNum, acc)) return lvl
          return acc
        }, null)
        if (best) finish(best)
      }
    }
    if (request.type === 'generateLevelByDifficulty') {
      worker.postMessage({ type: 'generateLevelByDifficulty', difficulty: request.difficulty, puzzleIndex: request.puzzleIndex, globalSeed: request.globalSeed, salt: i })
    } else {
      worker.postMessage({ type: 'generateLevel', levelNum: request.levelNum, puzzleSeed: request.puzzleSeed, salt: i })
    }
  })

  return () => { settled = true; cleanup() }
}
