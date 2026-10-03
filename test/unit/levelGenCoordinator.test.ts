import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { GeneratedLevel } from '../../client/src/lib/levelGen/types'

// levelGenCoordinator.ts races several real Web Workers, which don't exist in
// this (Node) test environment — `new Worker(...)` throws `Worker is not
// defined` here, so the coordinator's actual message-passing/race/cancellation
// logic had zero test coverage before this file (the existing
// parallelGeneration.test.ts benchmark only calls generateLevel directly in a
// loop, simulating outcomes but never exercising runLevelGeneration itself).
// Mock the `?worker` import with a controllable fake so postMessage/onmessage/
// onerror/terminate can be driven directly from the test.
type FakeWorkerInstance = {
  onmessage: ((e: { data: unknown }) => void) | null
  onerror: ((e: { message: string }) => void) | null
  postMessage: ReturnType<typeof vi.fn>
  terminate: ReturnType<typeof vi.fn>
}

const instances = vi.hoisted(() => [] as FakeWorkerInstance[])
const pooled = vi.hoisted(() => ({ fn: vi.fn() }))
const server = vi.hoisted(() => ({ fn: vi.fn() }))

vi.mock('../../client/src/lib/serverPuzzleStore', () => ({ getStorePuzzle: (...a: unknown[]) => server.fn(...a) }))
vi.mock('../../client/src/lib/pregeneratedPool', () => ({ getPooledLevel: (...a: unknown[]) => pooled.fn(...a) }))

vi.mock('../../client/src/lib/levelGen.worker?worker', () => {
  return {
    default: class {
      onmessage: FakeWorkerInstance['onmessage'] = null
      onerror: FakeWorkerInstance['onerror'] = null
      postMessage = vi.fn()
      terminate = vi.fn()
      constructor() { instances.push(this) }
    },
  }
})

// generateLevel/generateLevelByDifficulty are called synchronously as a last
// resort if every worker errors — stub them so that path is cheap and
// deterministic to test rather than running a real (possibly slow) generation.
vi.mock('../../client/src/lib/levelGen', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../client/src/lib/levelGen')>()
  return {
    ...actual,
    generateLevel: vi.fn(() => makeLevel({ gateMet: true, rounds: 999 })),
    generateLevelByDifficulty: vi.fn(() => makeLevel({ gateMet: true, rounds: 999 })),
    // in-thread last resort for the hard/expert search: yields once, then "finds" a puzzle
    searchTierStream: vi.fn(function* () { yield { attempts: 1 }; return { level: makeLevel({ rounds: 4242 }) } }),
  }
})

function makeLevel(overrides: Partial<GeneratedLevel> = {}): GeneratedLevel {
  return {
    size: 10,
    regions: [],
    solution: [],
    colors: [],
    difficulty: 10,
    easySteps: 5,
    hardSteps: 0,
    boundaries: 60,
    rounds: 1,
    maxSubsetSize: 0,
    symmetric: false,
    strategiesUsed: 1,
    techniqueCounts: {},
    gateMet: false,
    ...overrides,
  }
}

beforeEach(() => {
  instances.length = 0
  vi.clearAllMocks()
  pooled.fn.mockReset(); server.fn.mockReset()
  pooled.fn.mockResolvedValue(null); server.fn.mockResolvedValue(null)
})

describe('runLevelGeneration', () => {
  it('finishes as soon as one worker reports a gateMet win, and cancels the rest', async () => {
    const { runLevelGeneration, WORKER_COUNT } = await import('../../client/src/lib/levelGenCoordinator')
    const results: GeneratedLevel[] = []
    runLevelGeneration({ type: 'generateLevel', levelNum: 18, puzzleSeed: 0 }, () => {}, (lvl) => results.push(lvl))

    expect(instances).toHaveLength(WORKER_COUNT)
    const winner = makeLevel({ gateMet: true, rounds: 7 })
    instances[0].onmessage!({ data: { type: 'result', level: winner } })

    expect(results).toEqual([winner])
    for (const w of instances) expect(w.terminate).toHaveBeenCalledOnce()
  })

  // A single race attempt missing gateMet no longer settles immediately —
  // runLevelGeneration retries up to MAX_ATTEMPTS (3) times with fresh salts
  // before giving up (see the coordinator's own comment on why: expert tier's
  // fork-anchored geometry only lands a genuine win ~25% of the time per
  // attempt, so settling after one attempt silently ships a technique-free
  // puzzle under the "expert" label three times out of four).
  it('retries with a fresh salt range when an attempt misses, and resolves to a later attempt\'s gateMet win', async () => {
    const { runLevelGeneration, WORKER_COUNT } = await import('../../client/src/lib/levelGenCoordinator')
    const results: GeneratedLevel[] = []
    runLevelGeneration({ type: 'generateLevel', levelNum: 18, puzzleSeed: 0 }, () => {}, (lvl) => results.push(lvl))

    expect(instances).toHaveLength(WORKER_COUNT)
    const weak = makeLevel({ gateMet: false, rounds: 1 })
    for (let i = 0; i < WORKER_COUNT; i++) {
      instances[i].onmessage!({ data: { type: 'result', level: weak } })
    }

    // Attempt 1 missed entirely — a second attempt's workers should have
    // been spun up, using salts offset by WORKER_COUNT (not 0..WORKER_COUNT-1
    // again — a retread of the same RNG stream wouldn't be an independent
    // search).
    expect(instances).toHaveLength(2 * WORKER_COUNT)
    expect(results).toHaveLength(0)
    for (let i = 0; i < WORKER_COUNT; i++) {
      expect(instances[WORKER_COUNT + i].postMessage).toHaveBeenCalledWith(
        expect.objectContaining({ salt: WORKER_COUNT + i }),
      )
    }

    const winner = makeLevel({ gateMet: true, rounds: 9 })
    instances[WORKER_COUNT].onmessage!({ data: { type: 'result', level: winner } })

    expect(results).toEqual([winner])
    // The winning attempt's workers are cancelled; no third attempt spun up.
    expect(instances).toHaveLength(2 * WORKER_COUNT)
    for (const w of instances.slice(WORKER_COUNT)) expect(w.terminate).toHaveBeenCalledOnce()
  })

  it('falls back to the best-ranked candidate seen across every attempt once all MAX_ATTEMPTS miss', async () => {
    const { runLevelGeneration, WORKER_COUNT } = await import('../../client/src/lib/levelGenCoordinator')
    const results: GeneratedLevel[] = []
    runLevelGeneration({ type: 'generateLevel', levelNum: 18, puzzleSeed: 0 }, () => {}, (lvl) => results.push(lvl))

    const weak = makeLevel({ gateMet: false, rounds: 1 })
    // The strongest candidate of the whole run appears in attempt 1, not the
    // final attempt — the fallback choice must remember it across attempts
    // rather than only comparing within the last attempt's results.
    const strong = makeLevel({ gateMet: false, rounds: 5, strategiesUsed: 96 }) // hits expert's minStratBit
    for (let i = 0; i < WORKER_COUNT; i++) {
      instances[i].onmessage!({ data: { type: 'result', level: i === 2 ? strong : weak } })
    }
    expect(results).toHaveLength(0) // attempt 1 missed, retrying

    // Attempts 2 and 3: every worker reports something weaker than `strong`.
    for (let attempt = 1; attempt < 3; attempt++) {
      for (let i = 0; i < WORKER_COUNT; i++) {
        instances[attempt * WORKER_COUNT + i].onmessage!({ data: { type: 'result', level: weak } })
      }
    }

    expect(instances).toHaveLength(3 * WORKER_COUNT) // MAX_ATTEMPTS reached, no 4th attempt
    expect(results).toEqual([strong])
  })

  // Regression test for the worker-error hang: previously a worker whose
  // generateLevel call threw an uncaught exception never posted a 'result'
  // message, so doneCount never reached WORKER_COUNT and — unless another
  // worker had already won outright — onResult was never called at all,
  // hanging the caller's generation screen forever with no error surfaced.
  // Still holds across the retry loop: an errored worker in any attempt must
  // not block that attempt's checkDone, or the retry chain itself would hang.
  it('does not hang if one worker errors out each attempt — still resolves via best fallback after MAX_ATTEMPTS', async () => {
    const { runLevelGeneration, WORKER_COUNT } = await import('../../client/src/lib/levelGenCoordinator')
    const results: GeneratedLevel[] = []
    runLevelGeneration({ type: 'generateLevel', levelNum: 18, puzzleSeed: 0 }, () => {}, (lvl) => results.push(lvl))

    const fallback = makeLevel({ gateMet: false, rounds: 3 })
    for (let attempt = 0; attempt < 3; attempt++) {
      const base = attempt * WORKER_COUNT
      instances[base].onerror!({ message: 'boom' })
      for (let i = 1; i < WORKER_COUNT; i++) {
        instances[base + i].onmessage!({ data: { type: 'result', level: fallback } })
      }
    }

    expect(results).toEqual([fallback])
  })

  it('does not hang if every worker errors out on every attempt — falls back to a synchronous in-thread generation', async () => {
    const { runLevelGeneration, WORKER_COUNT } = await import('../../client/src/lib/levelGenCoordinator')
    const results: GeneratedLevel[] = []
    runLevelGeneration({ type: 'generateLevel', levelNum: 18, puzzleSeed: 0 }, () => {}, (lvl) => results.push(lvl))

    for (let attempt = 0; attempt < 3; attempt++) {
      for (let i = 0; i < WORKER_COUNT; i++) instances[attempt * WORKER_COUNT + i].onerror!({ message: 'boom' })
    }

    expect(results).toHaveLength(1)
    expect(results[0].gateMet).toBe(true) // from the stubbed generateLevel fallback
  })

  it('ignores late messages after the race has already settled', async () => {
    const { runLevelGeneration, WORKER_COUNT } = await import('../../client/src/lib/levelGenCoordinator')
    const results: GeneratedLevel[] = []
    runLevelGeneration({ type: 'generateLevel', levelNum: 18, puzzleSeed: 0 }, () => {}, (lvl) => results.push(lvl))

    const winner = makeLevel({ gateMet: true, rounds: 9 })
    instances[0].onmessage!({ data: { type: 'result', level: winner } })
    // A slower worker's message arrives after settlement — must not re-fire onResult.
    instances[1].onmessage!({ data: { type: 'result', level: makeLevel({ gateMet: true, rounds: 20 }) } })
    instances[2].onerror!({ message: 'late boom' })

    expect(results).toEqual([winner])
  })

  it('the returned cancel function terminates every worker and suppresses further results', async () => {
    const { runLevelGeneration, WORKER_COUNT } = await import('../../client/src/lib/levelGenCoordinator')
    const results: GeneratedLevel[] = []
    const cancel = runLevelGeneration({ type: 'generateLevel', levelNum: 18, puzzleSeed: 0 }, () => {}, (lvl) => results.push(lvl))

    cancel()
    for (const w of instances) expect(w.terminate).toHaveBeenCalledOnce()

    instances[0].onmessage!({ data: { type: 'result', level: makeLevel({ gateMet: true }) } })
    expect(results).toHaveLength(0)
  })

  it('reports each worker\'s progress independently rather than one shared line', async () => {
    const { runLevelGeneration, WORKER_COUNT } = await import('../../client/src/lib/levelGenCoordinator')
    const progressCalls: string[][] = []
    runLevelGeneration({ type: 'generateLevel', levelNum: 18, puzzleSeed: 0 }, (statuses) => progressCalls.push(statuses), () => {})

    instances[0].onmessage!({ data: { type: 'progress', msg: 'worker 0 searching…' } })
    expect(progressCalls.at(-1)![0]).toBe('worker 0 searching…')
    expect(progressCalls.at(-1)).toHaveLength(WORKER_COUNT)

    instances[1].onmessage!({ data: { type: 'progress', msg: 'worker 1 searching…' } })
    expect(progressCalls.at(-1)![0]).toBe('worker 0 searching…') // worker 0's slot persists
    expect(progressCalls.at(-1)![1]).toBe('worker 1 searching…')
  })

  // Regression coverage for the phase-preemption bug: workers run
  // generateLevelPhased one phase per message (see generate.ts), and must
  // stay in lockstep — a worker that raced through several cheap phases
  // shouldn't be able to win with a later, shallower phase's result while a
  // sibling is still mid-search in an earlier phase the whole cohort hasn't
  // finished yet.
  it('does not advance any worker to the next phase until every active worker reports phaseDone', async () => {
    const { runLevelGeneration, WORKER_COUNT } = await import('../../client/src/lib/levelGenCoordinator')
    runLevelGeneration({ type: 'generateLevel', levelNum: 18, puzzleSeed: 0 }, () => {}, () => {})

    for (let i = 0; i < WORKER_COUNT - 1; i++) {
      instances[i].onmessage!({ data: { type: 'phaseDone', phase: 'phase0' } })
    }
    // Not everyone has reported in yet — nobody should be told to advance.
    for (const w of instances) expect(w.postMessage).not.toHaveBeenCalledWith({ type: 'advance' })

    instances[WORKER_COUNT - 1].onmessage!({ data: { type: 'phaseDone', phase: 'phase0' } })
    // Now that the whole cohort finished phase0 with no hit, everyone advances together.
    for (const w of instances) expect(w.postMessage).toHaveBeenCalledWith({ type: 'advance' })
  })

  it('an errored worker does not block the phase barrier for the rest', async () => {
    const { runLevelGeneration, WORKER_COUNT } = await import('../../client/src/lib/levelGenCoordinator')
    runLevelGeneration({ type: 'generateLevel', levelNum: 18, puzzleSeed: 0 }, () => {}, () => {})

    instances[0].onerror!({ message: 'boom' })
    for (let i = 1; i < WORKER_COUNT; i++) {
      instances[i].onmessage!({ data: { type: 'phaseDone', phase: 'phase0' } })
    }
    // The errored worker (0) is out of the race — the rest shouldn't wait on it.
    for (let i = 1; i < WORKER_COUNT; i++) expect(instances[i].postMessage).toHaveBeenCalledWith({ type: 'advance' })
    expect(instances[0].postMessage).not.toHaveBeenCalledWith({ type: 'advance' })
  })

  it('a mid-round outright win still cancels every worker, even ones still on an earlier phase', async () => {
    const { runLevelGeneration, WORKER_COUNT } = await import('../../client/src/lib/levelGenCoordinator')
    const results: GeneratedLevel[] = []
    runLevelGeneration({ type: 'generateLevel', levelNum: 18, puzzleSeed: 0 }, () => {}, (lvl) => results.push(lvl))

    // Worker 0 finishes phase0 with a hit while others are still mid-phase.
    const winner = makeLevel({ gateMet: true, rounds: 4 })
    instances[0].onmessage!({ data: { type: 'result', level: winner } })

    expect(results).toEqual([winner])
    for (const w of instances) expect(w.terminate).toHaveBeenCalledOnce()
  })
})

describe('runLevelGeneration: pre-generated pool', () => {
  const req = { type: 'generateLevelByDifficulty' as const, difficulty: 'expert' as const, puzzleIndex: 3, globalSeed: 7 }
  const flush = () => new Promise(r => setTimeout(r, 0))

  it('uses a pooled puzzle without ever starting a worker', async () => {
    const { runLevelGeneration } = await import('../../client/src/lib/levelGenCoordinator')
    const lvl = makeLevel({ gateMet: true, rounds: 4 })
    pooled.fn.mockResolvedValue(lvl)
    const results: GeneratedLevel[] = []
    runLevelGeneration(req, () => {}, l => results.push(l))
    await flush()
    expect(pooled.fn).toHaveBeenCalledWith('expert', 3, 7)
    expect(results).toEqual([lvl])
    expect(instances.length).toBe(0)
  })

  it('falls back to the worker race when the pool has nothing', async () => {
    const { runLevelGeneration } = await import('../../client/src/lib/levelGenCoordinator')
    pooled.fn.mockResolvedValue(null)
    runLevelGeneration(req, () => {}, () => {})
    await flush()
    expect(instances.length).toBeGreaterThan(0)
  })

  it('falls back to workers when the pool lookup rejects', async () => {
    const { runLevelGeneration } = await import('../../client/src/lib/levelGenCoordinator')
    pooled.fn.mockRejectedValue(new Error('boom'))
    runLevelGeneration(req, () => {}, () => {})
    await flush()
    expect(instances.length).toBeGreaterThan(0)
  })

  it('cancelling before the pool resolves starts nothing and delivers nothing', async () => {
    const { runLevelGeneration } = await import('../../client/src/lib/levelGenCoordinator')
    pooled.fn.mockResolvedValue(makeLevel({ gateMet: true }))
    const results: GeneratedLevel[] = []
    const cancel = runLevelGeneration(req, () => {}, l => results.push(l))
    cancel()
    await flush()
    expect(results).toEqual([])
    expect(instances.length).toBe(0)
  })

  it('never consults the pool for non-difficulty requests', async () => {
    const { runLevelGeneration } = await import('../../client/src/lib/levelGenCoordinator')
    runLevelGeneration({ type: 'generateLevel', levelNum: 18, puzzleSeed: 0 }, () => {}, () => {})
    await flush()
    expect(pooled.fn).not.toHaveBeenCalled()
    expect(instances.length).toBeGreaterThan(0)
  })
})

describe('runLevelGeneration: server store -> static pool -> workers', () => {
  const req = { type: 'generateLevelByDifficulty' as const, difficulty: 'hard' as const, puzzleIndex: 5, globalSeed: 2 }
  const flush = () => new Promise(r => setTimeout(r, 0))
  const run = async (opts?: { serverStore?: boolean }) => {
    const { runLevelGeneration } = await import('../../client/src/lib/levelGenCoordinator')
    const results: GeneratedLevel[] = []
    const cancel = runLevelGeneration(req, () => {}, l => results.push(l), opts)
    await flush()
    return { results, cancel }
  }

  it('prefers the server puzzle when enabled, without touching the pool or workers', async () => {
    const lvl = makeLevel({ gateMet: true, rounds: 77 })
    server.fn.mockResolvedValue(lvl)
    const { results } = await run({ serverStore: true })
    expect(server.fn).toHaveBeenCalledWith('hard')
    expect(results).toEqual([lvl])
    expect(pooled.fn).not.toHaveBeenCalled()
    expect(instances.length).toBe(0)
  })

  it('falls to the static pool when the server has nothing', async () => {
    const lvl = makeLevel({ gateMet: true, rounds: 55 })
    pooled.fn.mockResolvedValue(lvl)
    const { results } = await run({ serverStore: true })
    expect(results).toEqual([lvl])
    expect(instances.length).toBe(0)
  })

  it('falls to the static pool when the server lookup rejects', async () => {
    const lvl = makeLevel({ gateMet: true })
    server.fn.mockRejectedValue(new Error('offline'))
    pooled.fn.mockResolvedValue(lvl)
    const { results } = await run({ serverStore: true })
    expect(results).toEqual([lvl])
  })

  it('falls all the way to on-device workers when server and pool both come up empty', async () => {
    const { results } = await run({ serverStore: true })
    expect(results).toEqual([])
    expect(instances.length).toBeGreaterThan(0)
  })

  it('does not ask the server unless serverStore is on (co-op / spectate)', async () => {
    server.fn.mockResolvedValue(makeLevel({ gateMet: true }))
    await run()
    expect(server.fn).not.toHaveBeenCalled()
    expect(pooled.fn).toHaveBeenCalled()
  })

  it('cancelling while the server request is in flight delivers nothing and starts no workers', async () => {
    let resolve!: (l: GeneratedLevel) => void
    server.fn.mockReturnValue(new Promise<GeneratedLevel>(r => { resolve = r }))
    const { runLevelGeneration } = await import('../../client/src/lib/levelGenCoordinator')
    const results: GeneratedLevel[] = []
    const cancel = runLevelGeneration(req, () => {}, l => results.push(l), { serverStore: true })
    cancel()
    resolve(makeLevel({ gateMet: true }))
    await flush()
    expect(results).toEqual([])
    expect(instances.length).toBe(0)
  })
})

describe('runLevelGeneration: on-device search for hard/expert', () => {
  const flush = () => new Promise(r => setTimeout(r, 0))
  const reqFor = (difficulty: 'easy' | 'medium' | 'hard' | 'expert') =>
    ({ type: 'generateLevelByDifficulty' as const, difficulty, puzzleIndex: 5, globalSeed: 2 })
  const base = 5 + 2 * 10007
  type Posted = { type: string; tier?: string; firstSeed?: number; stride?: number }
  const posted = (i: number): Posted => instances[i].postMessage.mock.calls[0][0]

  it('hands each worker its own seed stream and asks it to search the tier', async () => {
    const { runLevelGeneration, WORKER_COUNT } = await import('../../client/src/lib/levelGenCoordinator')
    runLevelGeneration(reqFor('expert'), () => {}, () => {})
    await flush()
    expect(instances.length).toBe(WORKER_COUNT)
    for (let i = 0; i < WORKER_COUNT; i++) {
      expect(posted(i)).toMatchObject({ type: 'searchTier', tier: 'expert', firstSeed: base + i, stride: WORKER_COUNT })
    }
  })

  it('finishes with the first worker to clear the bar and terminates the rest', async () => {
    const { runLevelGeneration, WORKER_COUNT } = await import('../../client/src/lib/levelGenCoordinator')
    const results: GeneratedLevel[] = []
    runLevelGeneration(reqFor('hard'), () => {}, l => results.push(l))
    await flush()
    const winner = makeLevel({ rounds: 31 })
    instances[WORKER_COUNT - 1].onmessage?.({ data: { type: 'result', level: winner } })
    expect(results).toEqual([winner])
    instances.forEach(w => expect(w.terminate).toHaveBeenCalled())
    instances[0].onmessage?.({ data: { type: 'result', level: makeLevel({ rounds: 1 }) } })   // late result ignored
    expect(results).toEqual([winner])
  })

  it('reports each worker\'s search progress on its own line', async () => {
    const { runLevelGeneration, WORKER_COUNT } = await import('../../client/src/lib/levelGenCoordinator')
    const seen: string[][] = []
    runLevelGeneration(reqFor('expert'), s => seen.push(s), () => {})
    await flush()
    instances[0].onmessage?.({ data: { type: 'progress', msg: 'Searching for a expert puzzle… 3 layouts tried' } })
    expect(seen[seen.length - 1][0]).toContain('3 layouts tried')
    if (WORKER_COUNT > 1) expect(seen[seen.length - 1][1]).toBe('')
  })

  it('never settles for less: a worker error or an empty message does not produce a result', async () => {
    const { runLevelGeneration, WORKER_COUNT } = await import('../../client/src/lib/levelGenCoordinator')
    const results: GeneratedLevel[] = []
    runLevelGeneration(reqFor('expert'), () => {}, l => results.push(l))
    await flush()
    instances[0].onmessage?.({ data: { type: 'result' } })   // no level attached
    if (WORKER_COUNT > 1) instances[0].onerror?.({ message: 'boom' })
    await flush()
    expect(results).toEqual([])
  })

  it('searches on this thread, at the same bar, only if every worker is down', async () => {
    const { runLevelGeneration, WORKER_COUNT } = await import('../../client/src/lib/levelGenCoordinator')
    const results: GeneratedLevel[] = []
    runLevelGeneration(reqFor('expert'), () => {}, l => results.push(l))
    await flush()
    for (let i = 0; i < WORKER_COUNT; i++) instances[i].onerror?.({ message: 'no workers here' })
    await new Promise(r => setTimeout(r, 30))
    expect(results).toHaveLength(1)
    expect(results[0].rounds).toBe(4242)
  })

  it('co-op (one worker) walks a single, request-determined seed stream', async () => {
    const { runLevelGeneration } = await import('../../client/src/lib/levelGenCoordinator')
    runLevelGeneration(reqFor('hard'), () => {}, () => {}, { maxWorkers: 1 })
    await flush()
    expect(instances.length).toBe(1)
    expect(posted(0)).toMatchObject({ type: 'searchTier', tier: 'hard', firstSeed: base, stride: 1 })
  })

  it('easy and medium still use the phased generator, not the search', async () => {
    const { runLevelGeneration } = await import('../../client/src/lib/levelGenCoordinator')
    for (const d of ['easy', 'medium'] as const) {
      instances.length = 0
      runLevelGeneration(reqFor(d), () => {}, () => {})
      await flush()
      expect(instances.length).toBeGreaterThan(0)
      expect(posted(0).type).toBe('generateLevelByDifficulty')
    }
  })

  it('cancelling stops the search workers', async () => {
    const { runLevelGeneration } = await import('../../client/src/lib/levelGenCoordinator')
    const results: GeneratedLevel[] = []
    const cancel = runLevelGeneration(reqFor('expert'), () => {}, l => results.push(l))
    await flush()
    cancel()
    instances.forEach(w => expect(w.terminate).toHaveBeenCalled())
    instances[0].onmessage?.({ data: { type: 'result', level: makeLevel() } })
    expect(results).toEqual([])
  })
})
