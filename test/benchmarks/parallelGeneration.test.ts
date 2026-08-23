import { describe, it, expect } from 'vitest'
import { generateLevelByDifficulty, DIFFICULTY_LEVEL, type Difficulty } from '../../client/src/lib/levelGen/index'

// Diagnoses the parallel-worker generation race (levelGenCoordinator.ts):
// does racing WORKER_COUNT salted, budget-divided generateLevel calls
// actually land a genuine tier-passing puzzle (gateMet), and how does its
// wall-clock time compare to a single full-budget run? Simulates the race
// sequentially (workers can't run concurrently in this test process) using
// the same budgetDivisor the real coordinator applies, so raceMaxMs is a
// reasonable proxy for the real worst-case latency (bounded by the slowest
// worker, which now only has to exhaust budget/WORKER_COUNT attempts instead
// of the full budget — see generateLevel's own comment on budgetDivisor).
//
// This is deliberately log-only, not a strict per-seed assertion: because
// each worker now gets only 1/WORKER_COUNT of the total attempt budget
// (splitting the same total attempts across workers instead of multiplying
// them, so total CPU cost and combined hit probability match a single
// full-budget run — see generateLevel's comment), a single worker missing
// while the aggregate single-threaded run of the same total budget hits is
// expected sampling noise, not a regression. What's actually worth catching
// here is structural breakage (a crash, a malformed result) and the
// discoverability of this diagnostic for whoever investigates generation
// speed/quality next — a strict pass/fail on RNG luck would just be flaky.
//
// Run directly with `pnpm test:bench -- parallelGeneration` (or `npm run
// test:bench`) — it's slow (each expert-tier call can take several seconds to
// over a minute in a slow environment) so it's excluded from the default
// `test`/`test:quick` runs.
function diagnoseParallel(difficulty: Difficulty, seeds: number[], workerCount: number) {
  const levelNum = DIFFICULTY_LEVEL[difficulty]
  const salts = Array.from({ length: workerCount }, (_, i) => i)
  const rows: { seed: number; singleMs: number; singleGateMet: boolean; raceMaxMs: number; raceAnyGateMet: boolean; saltGateMet: boolean[] }[] = []

  for (const seed of seeds) {
    const t0 = performance.now()
    const single = generateLevelByDifficulty(difficulty, seed, 0, undefined, 0, 1)
    const singleMs = performance.now() - t0
    expect(typeof single.gateMet).toBe('boolean')

    let raceMaxMs = 0
    const saltGateMet: boolean[] = []
    for (const salt of salts) {
      const t = performance.now()
      const lvl = generateLevelByDifficulty(difficulty, seed, 0, undefined, salt, workerCount)
      raceMaxMs = Math.max(raceMaxMs, performance.now() - t)
      expect(typeof lvl.gateMet).toBe('boolean')
      saltGateMet.push(lvl.gateMet)
    }

    rows.push({ seed, singleMs, singleGateMet: single.gateMet, raceMaxMs, raceAnyGateMet: saltGateMet.some(Boolean), saltGateMet })
  }

  console.log(`\n[${difficulty}] levelNum=${levelNum} workers=${workerCount} (each gets 1/${workerCount} of the full attempt budget)`)
  for (const r of rows) {
    console.log(
      `  seed=${r.seed} single(full budget): gateMet=${r.singleGateMet} time=${r.singleMs.toFixed(0)}ms` +
      ` | race(budget/${workerCount} each): anyGateMet=${r.raceAnyGateMet} [${r.saltGateMet.join(',')}] maxTime=${r.raceMaxMs.toFixed(0)}ms`
    )
  }
  const singleGateRate = rows.filter(r => r.singleGateMet).length / rows.length
  const raceGateRate = rows.filter(r => r.raceAnyGateMet).length / rows.length
  console.log(`  single gateMet rate: ${(singleGateRate * 100).toFixed(0)}% | race (any of ${workerCount}) gateMet rate: ${(raceGateRate * 100).toFixed(0)}%`)

  return rows
}

describe('parallel generation diagnostic', () => {
  it('expert: logs single-vs-race gateMet outcome and timing', () => {
    diagnoseParallel('expert', [0], 2)
  }, 300_000)

  it('hard: logs single-vs-race gateMet outcome and timing', () => {
    diagnoseParallel('hard', [0], 2)
  }, 120_000)
})
