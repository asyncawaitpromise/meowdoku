import LevelGenWorker from './levelGen.worker?worker'
import { DIFFICULTY_LEVEL, rankGeneratedLevel, generateLevel, generateLevelByDifficulty } from './levelGen'
import type { GeneratedLevel, Difficulty } from './levelGen'

export type GenRequest =
  | { type: 'generateLevel'; levelNum: number; puzzleSeed: number }
  | { type: 'generateLevelByDifficulty'; difficulty: Difficulty; puzzleIndex: number; globalSeed: number }

// navigator.hardwareConcurrency is inflated on some mobile devices, so cap
// rather than trust it outright; generation is bursty enough that going
// wider than 4 mostly burns battery without shortening the worst case.
export const WORKER_COUNT = Math.max(1, Math.min(navigator.hardwareConcurrency || 4, 4))

// How many independent race attempts to run before settling for the
// best-ranked non-gateMet candidate seen. Measured empirically (see the
// "external-reference-profile"/quality-audit work): a single WORKER_COUNT-way
// race at expert tier only lands a genuine gateMet:true puzzle ~25% of the
// time (fork-anchored's branch-rule/forcing-chain geometry is inherently
// probabilistic — see growForkAnchored's own comment), so settling after one
// attempt silently ships a technique-free puzzle under the "expert" label
// three times out of four. Each retry uses a fresh salt range (see
// `runAttempt`'s `saltBase`), so it's a genuinely independent search rather
// than a retread — `generateLevelPhased`'s own comment confirms salt
// perturbs the RNG stream without changing which puzzle a seed maps to.
// Hard tier hits its gate ~100% of the time in the same measurement, so this
// adds no practical latency there — the retry path essentially never fires.
const MAX_ATTEMPTS = 3

/**
 * Races WORKER_COUNT workers through generateLevelPhased's phases in lockstep
 * (one phase per message; see the phase barrier below), splitting each
 * phase's attempt budget across them so the combined hit probability matches
 * a single-worker full-budget run while cutting worst-case wall time and
 * total CPU roughly back down to that single-worker amount. If an entire
 * race attempt misses gateMet (every worker falls back), retries up to
 * MAX_ATTEMPTS times with fresh salts before settling for the best-ranked
 * fallback seen across every attempt.
 *
 * Returns a cancel function; call it (e.g. on unmount or when the request
 * changes) to terminate any still-running workers.
 */
export function runLevelGeneration(
  request: GenRequest,
  onProgress: (statuses: string[]) => void,
  onResult: (level: GeneratedLevel) => void,
): () => void {
  const levelNum = request.type === 'generateLevel' ? request.levelNum : DIFFICULTY_LEVEL[request.difficulty]

  let settled = false
  let currentWorkers: LevelGenWorker[] = []
  // Best gateMet:false candidate seen across every attempt so far, kept in
  // case every attempt ultimately misses — otherwise a strong attempt-1
  // fallback could get discarded in favor of a weaker attempt-2 one.
  let bestFallback: GeneratedLevel | null = null

  const finish = (level: GeneratedLevel) => {
    if (settled) return
    settled = true
    onResult(level)
    currentWorkers.forEach(w => w.terminate())
  }

  const runAttempt = (attempt: number, saltBase: number) => {
    if (settled) return
    const workers = Array.from({ length: WORKER_COUNT }, () => new LevelGenWorker())
    currentWorkers = workers
    const results: (GeneratedLevel | null)[] = Array(WORKER_COUNT).fill(null)
    const statuses: string[] = Array(WORKER_COUNT).fill('')
    let doneCount = 0

    // active: workers that haven't posted a final result and haven't errored.
    // pendingPhase: the subset of active still mid-phase this round. Once it
    // empties, every remaining active worker is told to advance together, so a
    // worker that races through several cheap phases can't steal a shallow win
    // while a sibling is still mid-search in a harder, more interesting phase.
    // Racing is still fair *within* a phase: first to clear that phase's own
    // gate wins outright.
    const active = new Set(workers.map((_, i) => i))
    let pendingPhase = new Set(active)

    const cleanup = () => { workers.forEach(w => w.terminate()) }

    const checkDone = () => {
      if (doneCount !== WORKER_COUNT) return
      for (const lvl of results) {
        if (lvl && (!bestFallback || rankGeneratedLevel(levelNum, lvl) > rankGeneratedLevel(levelNum, bestFallback))) {
          bestFallback = lvl
        }
      }
      if (attempt < MAX_ATTEMPTS) {
        cleanup()
        runAttempt(attempt + 1, saltBase + WORKER_COUNT)
        return
      }
      if (bestFallback) { finish(bestFallback); return }
      // Every worker across every attempt errored before producing even a
      // fallback candidate. generateLevel always returns a level on its own,
      // so this should be unreachable; run one synchronous in-thread
      // generation as a last resort rather than leaving the caller with no
      // result.
      finish(request.type === 'generateLevelByDifficulty'
        ? generateLevelByDifficulty(request.difficulty, request.puzzleIndex, request.globalSeed)
        : generateLevel(request.levelNum, request.puzzleSeed))
    }

    const maybeAdvance = () => {
      if (settled || pendingPhase.size > 0 || active.size === 0) return
      pendingPhase = new Set(active)
      for (const i of active) workers[i].postMessage({ type: 'advance' })
    }

    workers.forEach((worker, i) => {
      worker.onmessage = (e: MessageEvent<{ type: string; level?: GeneratedLevel; msg?: string; phase?: string }>) => {
        if (settled) return
        if (e.data.type === 'progress') {
          // Each worker's progress text describes its own local search as if
          // it were the only one running; keep every worker's latest line in
          // its own slot so the UI can show all concurrent searches honestly.
          statuses[i] = e.data.msg ?? ''
          onProgress([...statuses])
          return
        }
        if (e.data.type === 'phaseDone') {
          pendingPhase.delete(i)
          maybeAdvance()
          return
        }
        active.delete(i)
        pendingPhase.delete(i)
        const level = e.data.level ?? null
        results[i] = level
        doneCount++
        // gateMet is the acceptance decision generateLevel already made for
        // this candidate (including phase 0.8's relaxed expert-only bar);
        // recomputing it here would reject genuine phase-0.8 hits and stall
        // the race until every worker finishes.
        if (level && level.gateMet) {
          finish(level)
          return
        }
        checkDone()
        maybeAdvance()
      }
      worker.onerror = (ev: ErrorEvent) => {
        // A thrown worker never posts 'result', so without this handler
        // doneCount could never reach WORKER_COUNT and the race would hang.
        if (settled) return
        console.warn(`levelGenCoordinator: worker ${i} threw during generation (attempt ${attempt}), treating as a non-result`, ev.message)
        active.delete(i)
        pendingPhase.delete(i)
        results[i] = null
        doneCount++
        checkDone()
        maybeAdvance()
      }
      const salt = saltBase + i
      if (request.type === 'generateLevelByDifficulty') {
        worker.postMessage({ type: 'generateLevelByDifficulty', difficulty: request.difficulty, puzzleIndex: request.puzzleIndex, globalSeed: request.globalSeed, salt, budgetDivisor: WORKER_COUNT })
      } else {
        worker.postMessage({ type: 'generateLevel', levelNum: request.levelNum, puzzleSeed: request.puzzleSeed, salt, budgetDivisor: WORKER_COUNT })
      }
    })
  }

  runAttempt(1, 0)

  return () => { settled = true; currentWorkers.forEach(w => w.terminate()) }
}
