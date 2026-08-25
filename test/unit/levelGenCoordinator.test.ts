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
    gateMet: false,
    ...overrides,
  }
}

beforeEach(() => {
  instances.length = 0
  vi.clearAllMocks()
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

  it('falls back to the best-ranked candidate once every worker finishes without a gate-passing win', async () => {
    const { runLevelGeneration, WORKER_COUNT } = await import('../../client/src/lib/levelGenCoordinator')
    const results: GeneratedLevel[] = []
    runLevelGeneration({ type: 'generateLevel', levelNum: 18, puzzleSeed: 0 }, () => {}, (lvl) => results.push(lvl))

    const weak = makeLevel({ gateMet: false, rounds: 1 })
    const strong = makeLevel({ gateMet: false, rounds: 5, strategiesUsed: 96 }) // hits expert's minStratBit
    for (let i = 0; i < WORKER_COUNT; i++) {
      const level = i === 2 ? strong : weak
      instances[i].onmessage!({ data: { type: 'result', level } })
    }

    expect(results).toEqual([strong])
  })

  // Regression test for the worker-error hang: previously a worker whose
  // generateLevel call threw an uncaught exception never posted a 'result'
  // message, so doneCount never reached WORKER_COUNT and — unless another
  // worker had already won outright — onResult was never called at all,
  // hanging the caller's generation screen forever with no error surfaced.
  it('does not hang if one worker errors out — the remaining workers still resolve the race', async () => {
    const { runLevelGeneration, WORKER_COUNT } = await import('../../client/src/lib/levelGenCoordinator')
    const results: GeneratedLevel[] = []
    runLevelGeneration({ type: 'generateLevel', levelNum: 18, puzzleSeed: 0 }, () => {}, (lvl) => results.push(lvl))

    instances[0].onerror!({ message: 'boom' })
    const fallback = makeLevel({ gateMet: false, rounds: 3 })
    for (let i = 1; i < WORKER_COUNT; i++) {
      instances[i].onmessage!({ data: { type: 'result', level: fallback } })
    }

    expect(results).toEqual([fallback])
  })

  it('does not hang if every worker errors out — falls back to a synchronous in-thread generation', async () => {
    const { runLevelGeneration, WORKER_COUNT } = await import('../../client/src/lib/levelGenCoordinator')
    const results: GeneratedLevel[] = []
    runLevelGeneration({ type: 'generateLevel', levelNum: 18, puzzleSeed: 0 }, () => {}, (lvl) => results.push(lvl))

    for (let i = 0; i < WORKER_COUNT; i++) instances[i].onerror!({ message: 'boom' })

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
})
