import LevelGenWorker from './levelGen.worker?worker'
import { DIFFICULTY_LEVEL, rankGeneratedLevel, generateLevel, generateLevelByDifficulty, searchTierStream, searchSeedFor } from './levelGen'
import type { GeneratedLevel, Difficulty, SearchTier } from './levelGen'
import { getPooledLevel } from './pregeneratedPool'
import { getStorePuzzle } from './serverPuzzleStore'

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

// Tiers generated on the device by search-until-the-bar-is-met rather than by the phased
// rejection sampler: hard and expert have a whole-profile bar (see search/tiers.ts) that the
// sampler can't reliably reach, and a puzzle that misses it is simply not served.
const SEARCH_TIERS: ReadonlySet<Difficulty> = new Set<Difficulty>(['hard', 'expert'])

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
export interface GenOptions {
  // Co-op must produce the *identical* board on both participants' devices,
  // so it pins the worker count to 1: with multiple workers the first to cross
  // a phase gate wins, and which worker that is depends on timing + hardware —
  // two players would generate different boards and the shared board would be
  // meaningless. A single worker with a fixed salt is a pure function of
  // (difficulty, puzzleIndex, globalSeed), so both sides reproduce the exact
  // same regions/colors/solution.
  maxWorkers?: number
  // Single-player level requests take the next puzzle from the device's cache of the
  // server's curated store first (see serverPuzzleStore.ts). Left off for co-op/spectate,
  // whose two devices must agree on the board, which a per-player shuffled queue can't give.
  serverStore?: boolean
}

export function runLevelGeneration(
  request: GenRequest,
  onProgress: (statuses: string[]) => void,
  onResult: (level: GeneratedLevel) => void,
  options: GenOptions = {},
): () => void {
  const workerCount = Math.min(options.maxWorkers ?? WORKER_COUNT, WORKER_COUNT)
  const levelNum = request.type === 'generateLevel' ? request.levelNum : DIFFICULTY_LEVEL[request.difficulty]

  let settled = false
  let currentWorkers: InstanceType<typeof LevelGenWorker>[] = []
  // Best gateMet:false candidate seen across every attempt so far, kept in
  // case every attempt ultimately misses — a strong attempt-1
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
    const workers = Array.from({ length: workerCount }, () => new LevelGenWorker())
    currentWorkers = workers
    const results: (GeneratedLevel | null)[] = Array(workerCount).fill(null)
    const statuses: string[] = Array(workerCount).fill('')
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
      if (doneCount !== workerCount) return
      for (const lvl of results) {
        if (lvl && (!bestFallback || rankGeneratedLevel(levelNum, lvl) > rankGeneratedLevel(levelNum, bestFallback))) {
          bestFallback = lvl
        }
      }
      if (attempt < MAX_ATTEMPTS) {
        cleanup()
        runAttempt(attempt + 1, saltBase + workerCount)
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
        // doneCount could never reach workerCount and the race would hang.
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
        worker.postMessage({ type: 'generateLevelByDifficulty', difficulty: request.difficulty, puzzleIndex: request.puzzleIndex, globalSeed: request.globalSeed, salt, budgetDivisor: workerCount })
      } else {
        worker.postMessage({ type: 'generateLevel', levelNum: request.levelNum, puzzleSeed: request.puzzleSeed, salt, budgetDivisor: workerCount })
      }
    })
  }

  // On-device generation for hard/expert: every worker searches its own seed stream (worker i
  // takes seeds base+i, base+i+n, …) until one clears the tier's whole bar; the first to do so
  // wins and the rest are terminated. There is deliberately no best-effort result and no attempt
  // cap — a slow answer beats a puzzle that misses the bar. With one worker (co-op) the stream is
  // a pure function of the request, so both devices find the same puzzle.
  const runSearch = (tier: SearchTier, puzzleIndex: number, globalSeed: number) => {
    if (settled) return
    const base = searchSeedFor(puzzleIndex, globalSeed)
    const workers = Array.from({ length: workerCount }, () => new LevelGenWorker())
    currentWorkers = workers
    const statuses: string[] = Array(workerCount).fill('')
    let errored = 0

    // If no worker can run at all, search on this thread in short slices so the page stays
    // responsive. Same search, same bar.
    const searchInThread = () => {
      const stream = searchTierStream(tier, base, 1)
      const tick = () => {
        if (settled) return
        const next = stream.next()
        if (next.done) { finish(next.value.level); return }
        onProgress([`Searching for a ${tier} puzzle… ${next.value.attempts} layouts tried`])
        setTimeout(tick, 0)
      }
      setTimeout(tick, 0)
    }

    workers.forEach((worker, i) => {
      worker.onmessage = (e: MessageEvent<{ type: string; level?: GeneratedLevel; msg?: string }>) => {
        if (settled) return
        if (e.data.type === 'progress') { statuses[i] = e.data.msg ?? ''; onProgress([...statuses]); return }
        if (e.data.type === 'result' && e.data.level) finish(e.data.level)
      }
      worker.onerror = (ev: ErrorEvent) => {
        if (settled) return
        console.warn(`levelGenCoordinator: search worker ${i} threw, ${errored + 1}/${workerCount} down`, ev.message)
        if (++errored === workerCount) { workers.forEach(w => w.terminate()); searchInThread() }
      }
      worker.postMessage({ type: 'searchTier', tier, firstSeed: base + i, stride: workerCount })
    })
  }

  // Where a difficulty-mode puzzle comes from, best first:
  //   1. the next puzzle from the device's cache of the server's curated store (fresh for this player),
  //   2. the static pre-generated pool shipped with the app,
  //   3. generating on the device in workers (works fully offline). Hard/expert search until a puzzle
  //      clears the same bar as the offline generator; easy/medium use the phased generator.
  // Each stage that has nothing, errors or times out just hands over to the next.
  if (request.type === 'generateLevelByDifficulty') {
    const { difficulty, puzzleIndex, globalSeed } = request
    const fromServer = options.serverStore ? getStorePuzzle(difficulty).catch(() => null) : Promise.resolve(null)
    fromServer
      .then(level => level ?? getPooledLevel(difficulty, puzzleIndex, globalSeed).catch(() => null))
      .then(level => {
        if (settled) return
        if (level) finish(level)
        else if (SEARCH_TIERS.has(difficulty)) runSearch(difficulty as SearchTier, puzzleIndex, globalSeed)
        else runAttempt(1, 0)
      })
  } else {
    runAttempt(1, 0)
  }

  return () => { settled = true; currentWorkers.forEach(w => w.terminate()) }
}
