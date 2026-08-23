import { describe, it, expect } from 'vitest'
import { generateLevel, generateLevelByDifficulty, DIFFICULTY_LEVEL, type Difficulty } from '../../client/src/lib/levelGen/index'

// Diagnoses whether the parallel-worker generation race (levelGenCoordinator.ts)
// actually shortens time-to-puzzle for a given difficulty, or whether every
// worker ends up running to completion (no benefit — see the gateMet bug this
// caught: phase 0.8's relaxed forcing-chain/branch-rule acceptance was being
// re-checked against the full targetDifficulty gate, which silently rejected
// genuine expert hits and stalled the coordinator's early-exit for that tier
// specifically). Simulates an N-way race by running N salted generateLevel
// calls sequentially (workers can't run concurrently in this test process) and
// takes the max of their times as the race's wall-clock estimate — a lower
// bound on the real benefit, since real workers run concurrently rather than
// back-to-back.
//
// Run directly with `pnpm test:bench -- parallelGeneration` (or `npm run
// test:bench`) — it's slow (each expert-tier call can take several seconds to
// over a minute) so it's excluded from the default `test`/`test:quick` runs.
function diagnoseParallel(difficulty: Difficulty, seeds: number[], salts: number[]) {
  const levelNum = DIFFICULTY_LEVEL[difficulty]
  const rows: { seed: number; singleMs: number; singleGateMet: boolean; raceMaxMs: number; raceAnyGateMet: boolean; saltGateMet: boolean[] }[] = []

  for (const seed of seeds) {
    const t0 = performance.now()
    const single = generateLevelByDifficulty(difficulty, seed, 0, undefined, 0)
    const singleMs = performance.now() - t0

    let raceMaxMs = 0
    const saltGateMet: boolean[] = []
    for (const salt of salts) {
      const t = performance.now()
      const lvl = generateLevelByDifficulty(difficulty, seed, 0, undefined, salt)
      raceMaxMs = Math.max(raceMaxMs, performance.now() - t)
      saltGateMet.push(lvl.gateMet)
    }

    rows.push({ seed, singleMs, singleGateMet: single.gateMet, raceMaxMs, raceAnyGateMet: saltGateMet.some(Boolean), saltGateMet })
  }

  console.log(`\n[${difficulty}] levelNum=${levelNum} salts=${salts.length}`)
  for (const r of rows) {
    console.log(
      `  seed=${r.seed} single: gateMet=${r.singleGateMet} time=${r.singleMs.toFixed(0)}ms` +
      ` | race: anyGateMet=${r.raceAnyGateMet} [${r.saltGateMet.join(',')}] maxTime=${r.raceMaxMs.toFixed(0)}ms`
    )
  }
  const singleGateRate = rows.filter(r => r.singleGateMet).length / rows.length
  const raceGateRate = rows.filter(r => r.raceAnyGateMet).length / rows.length
  console.log(`  single gateMet rate: ${(singleGateRate * 100).toFixed(0)}% | race (any of ${salts.length}) gateMet rate: ${(raceGateRate * 100).toFixed(0)}%`)

  return rows
}

describe('parallel generation diagnostic', () => {
  it('expert: racing several salts should not reduce the outright-win rate vs a single salt', () => {
    const rows = diagnoseParallel('expert', [0], [0, 1])
    // A race across N independent salts should land an outright gateMet win at
    // least as often as any single one of them — if this regresses, something
    // (like the gateMet-vs-full-gate mixup this test was written to catch) is
    // suppressing the race's early-exit path again.
    for (const r of rows) {
      if (r.singleGateMet) expect(r.raceAnyGateMet).toBe(true)
    }
  }, 300_000)

  it('hard: racing several salts should not reduce the outright-win rate vs a single salt', () => {
    const rows = diagnoseParallel('hard', [0], [0, 1])
    for (const r of rows) {
      if (r.singleGateMet) expect(r.raceAnyGateMet).toBe(true)
    }
  }, 120_000)
})
