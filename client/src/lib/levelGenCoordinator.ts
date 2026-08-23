import LevelGenWorker from './levelGen.worker?worker'
import { DIFFICULTY_LEVEL, levelMeetsGate, rankGeneratedLevel } from './levelGen'
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
const WORKER_COUNT = Math.max(1, Math.min(navigator.hardwareConcurrency || 4, 4))

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
  onProgress: (msg: string) => void,
  onResult: (level: GeneratedLevel) => void,
): () => void {
  const levelNum = request.type === 'generateLevel' ? request.levelNum : DIFFICULTY_LEVEL[request.difficulty]

  const workers = Array.from({ length: WORKER_COUNT }, () => new LevelGenWorker())
  const results: (GeneratedLevel | null)[] = Array(WORKER_COUNT).fill(null)
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
        // Only worker 0's progress is surfaced — with several workers racing
        // on independent random streams, forwarding all of them would make
        // the status line jump between unrelated attempt counts.
        if (i === 0) onProgress(e.data.msg ?? '')
        return
      }
      const level = e.data.level ?? null
      results[i] = level
      doneCount++
      if (level && levelMeetsGate(levelNum, level)) {
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
