import LevelGenWorker from './levelGen.worker?worker'
import { DIFFICULTY_LEVEL, rankGeneratedLevel, generateLevel, generateLevelByDifficulty } from './levelGen'
import type { GeneratedLevel, Difficulty } from './levelGen'

export type GenRequest =
  | { type: 'generateLevel'; levelNum: number; puzzleSeed: number }
  | { type: 'generateLevelByDifficulty'; difficulty: Difficulty; puzzleIndex: number; globalSeed: number }

// Generation is rejection sampling: each attempt is an independent dice roll,
// and the slow phases (fork-anchored, band-anchored) run thousands of them
// per puzzle. Each worker gets its own salt (an uncorrelated random stream)
// *and* each phase's attempt budget divided by WORKER_COUNT (see
// generateLevel's budgetDivisor) — splitting the same total attempt count
// across workers rather than giving every worker the full budget. That
// combination keeps the combined hit probability identical to a single
// full-budget run (disjoint independent streams: P(≥1 hit) depends only on
// total attempts, not how they're split — see generateLevel's own comment),
// while cutting both the worst-case wall time (nobody hits: bounded by
// budget/WORKER_COUNT instead of the full budget) and the total CPU spent
// down to roughly the original single-worker amount. Giving every worker
// the full budget instead would raise the hit rate further at WORKER_COUNT
// times the CPU/battery cost, with no improvement to the worst case at all
// — every worker would still have to exhaust the whole budget before the
// coordinator could fall back, which is exactly what was observed happening.
// Capped at 4: box-of-hardware-threads mobile devices report inflated
// hardwareConcurrency, and generation is bursty enough that going wider
// mostly just burns battery without meaningfully shortening the race.
export const WORKER_COUNT = Math.max(1, Math.min(navigator.hardwareConcurrency || 4, 4))

// Spawns WORKER_COUNT parallel generation workers and steps them through
// generateLevel's phases in lockstep (see generateLevelPhased in generate.ts
// and the phase-barrier bookkeeping below) rather than letting each one race
// through the whole pipeline independently. Within a phase, the first worker
// to clear that phase's own difficulty gate wins outright and the rest are
// cancelled immediately — but a worker is never allowed to win with a later,
// shallower phase while a sibling is still mid-search in an earlier phase the
// whole cohort hasn't finished yet (previously possible: a worker that raced
// through several cheap, unlikely-to-hit phases could land a low-effort win
// and cancel a sibling still deep in fork/band-anchored's rarer, harder-to-
// reach geometry, without either of them — or the player — ever knowing a
// better candidate was in reach). If every worker exhausts every phase
// without clearing the gate — the same "bestRef" situation a single-threaded
// run can hit for hard/expert — the coordinator picks whichever worker's
// fallback ranks highest, using the exact ranking generateLevel uses
// internally for its own bestRef.
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

  // Phase-barrier bookkeeping: each worker runs generateLevelPhased (see
  // generate.ts), which does exactly one phase per message instead of the
  // whole pipeline in one shot, so this coordinator can keep every worker on
  // the same phase at once. `active` is every worker that hasn't yet posted
  // a final 'result' (an outright gate-passing win, or its own bestRef/
  // rescue/last-resort fallback once every phase failed) and hasn't errored.
  // `pendingPhase` is the subset of `active` still mid-phase for the current
  // round; once it empties, every remaining active worker gets told to
  // advance to the next phase together. Without this, a worker that raced
  // through several cheap, unlikely-to-hit phases could win with a shallow
  // result while a sibling was still mid-search in a harder-but-more-
  // interesting phase (fork/band-anchored) that never got a fair chance to
  // finish that same phase — see the coordinator's module comment above.
  // Racing is still allowed *within* a phase: whichever worker clears that
  // phase's own gate first legitimately wins, same rules for everyone.
  const active = new Set(workers.map((_, i) => i))
  let pendingPhase = new Set(active)

  const cleanup = () => { workers.forEach(w => w.terminate()) }

  const finish = (level: GeneratedLevel) => {
    if (settled) return
    settled = true
    onResult(level)
    cleanup()
  }

  // Called once a worker's slot is resolved, whether by a normal 'result'
  // message or by onWorkerError below. Centralizing this (rather than only
  // running it from onmessage, as before) matters because a worker that
  // throws an uncaught exception — a real risk given expert's fork-anchored
  // phase runs thousands of solver simulations per attempt — never posts a
  // 'result' message. Previously that meant its results[i] stayed null and
  // doneCount never reached WORKER_COUNT, so if no other worker had already
  // won outright, the race stalled forever: onResult was never called and
  // the UI's generation screen hung indefinitely with no error surfaced.
  const checkDone = () => {
    if (doneCount !== WORKER_COUNT) return
    // No worker landed an outright gate-passing puzzle — fall back to
    // the best-ranked result across all of them, same tie-break logic
    // generateLevel uses for its own single-worker bestRef fallback.
    const best = results.reduce<GeneratedLevel | null>((acc, lvl) => {
      if (!lvl) return acc
      if (!acc || rankGeneratedLevel(levelNum, lvl) > rankGeneratedLevel(levelNum, acc)) return lvl
      return acc
    }, null)
    if (best) { finish(best); return }
    // Every worker errored out before producing even a fallback candidate —
    // should be unreachable since generateLevel is designed to always return
    // a level (its own bestRef/rescue/last-resort phases never throw), but
    // if it somehow happens, run one synchronous full-budget generation
    // in-thread rather than leaving the caller hanging with no result.
    finish(request.type === 'generateLevelByDifficulty'
      ? generateLevelByDifficulty(request.difficulty, request.puzzleIndex, request.globalSeed)
      : generateLevel(request.levelNum, request.puzzleSeed))
  }

  // Once every still-racing worker has reported it finished the current
  // phase with no gate-passing hit, tell all of them to run the next phase.
  const maybeAdvance = () => {
    if (settled || pendingPhase.size > 0 || active.size === 0) return
    pendingPhase = new Set(active)
    for (const i of active) workers[i].postMessage({ type: 'advance' })
  }

  workers.forEach((worker, i) => {
    worker.onmessage = (e: MessageEvent<{ type: string; level?: GeneratedLevel; msg?: string; phase?: string }>) => {
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
      if (e.data.type === 'phaseDone') {
        pendingPhase.delete(i)
        maybeAdvance()
        return
      }
      // 'result': this worker is fully done — either an outright gate-passing
      // win, or (once every phase failed for the whole cohort) its own
      // bestRef/rescue/last-resort fallback answer. Either way it drops out
      // of the phase barrier so it can't block the rest from advancing.
      active.delete(i)
      pendingPhase.delete(i)
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
      checkDone()
      maybeAdvance()
    }
    worker.onerror = (ev: ErrorEvent) => {
      if (settled) return
      console.warn(`levelGenCoordinator: worker ${i} threw during generation, treating as a non-result`, ev.message)
      active.delete(i)
      pendingPhase.delete(i)
      results[i] = null
      doneCount++
      checkDone()
      maybeAdvance()
    }
    if (request.type === 'generateLevelByDifficulty') {
      worker.postMessage({ type: 'generateLevelByDifficulty', difficulty: request.difficulty, puzzleIndex: request.puzzleIndex, globalSeed: request.globalSeed, salt: i, budgetDivisor: WORKER_COUNT })
    } else {
      worker.postMessage({ type: 'generateLevel', levelNum: request.levelNum, puzzleSeed: request.puzzleSeed, salt: i, budgetDivisor: WORKER_COUNT })
    }
  })

  return () => { settled = true; cleanup() }
}
