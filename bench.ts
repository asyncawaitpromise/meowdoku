// Diagnostic benchmark — run with: npx tsx bench.ts
// Tests each generation component independently so we can see where time goes.

import {
  makeRng, findPlacement, findSymmetricPlacement,
  canSolveLogically, canSolveFast,
  growVoronoi, growSizeBalanced, growBalanced, growDiagonalSymmetric,
  boundaryCount, hasCorridor, maxRegionSize,
  difficultyScore, targetDifficulty,
} from './client/src/lib/levelGen.ts'

const N = 10

function fmt(ms: number) { return ms < 1 ? '<1ms' : `${ms.toFixed(1)}ms` }
function pct(n: number, d: number) { return d === 0 ? 'n/a' : `${((n / d) * 100).toFixed(1)}%` }

function section(title: string) {
  console.log(`\n${'─'.repeat(60)}`)
  console.log(`  ${title}`)
  console.log('─'.repeat(60))
}

// ── 1. Solver speed on Voronoi layouts ──────────────────────────────────────
section('1. Solver speed: canSolveLogically vs canSolveFast (50 Voronoi layouts)')

{
  const layouts: number[][][] = []
  for (let i = 0; i < 50; i++) {
    const rng = makeRng(i * 7919 + 1)
    const cols = findPlacement(N, rng)
    const seeds = cols.map((c, r) => ({ r, c }))
    layouts.push(growVoronoi(N, seeds, rng))
  }

  let slowMs = 0, fastMs = 0, slowSolved = 0, fastSolved = 0
  for (const grid of layouts) {
    const t1 = performance.now()
    const rs = canSolveLogically(grid, N)
    slowMs += performance.now() - t1
    if (rs.solved) slowSolved++

    const t2 = performance.now()
    const rf = canSolveFast(grid, N)
    fastMs += performance.now() - t2
    if (rf.solved) fastSolved++
  }

  console.log(`  canSolveLogically: avg ${fmt(slowMs / 50)} | solved ${pct(slowSolved, 50)}`)
  console.log(`  canSolveFast:      avg ${fmt(fastMs / 50)} | solved ${pct(fastSolved, 50)}`)
  console.log(`  speedup:           ${(slowMs / fastMs).toFixed(1)}×`)
}

// ── 2. Phase 1 (growSizeBalanced): raw solvability + difficulty pass rate ──
section('2. Phase 1: growSizeBalanced — 100 attempts per difficulty')

for (const [label, levelNum] of [['easy', 2], ['medium', 6], ['hard', 12], ['expert', 18]] as const) {
  const tgt = targetDifficulty(levelNum)
  let nSolvable = 0, nPassDiff = 0, nPassBoundary = 0, nPassCorridor = 0
  let totalSolveMs = 0, totalGrowMs = 0

  for (let i = 0; i < 100; i++) {
    const rng = makeRng(levelNum * 100003 + i * 6271)
    const cols = findPlacement(N, rng)
    const seeds = cols.map((c, r) => ({ r, c }))

    const t1 = performance.now()
    const grid = growSizeBalanced(N, seeds, rng)
    totalGrowMs += performance.now() - t1

    const bc = boundaryCount(grid, N)
    if (bc < 40) continue
    nPassBoundary++
    if (hasCorridor(grid, N)) continue
    nPassCorridor++

    const t2 = performance.now()
    const res = canSolveLogically(grid, N)
    totalSolveMs += performance.now() - t2

    if (!res.solved) continue
    nSolvable++

    const score = difficultyScore(res.strategiesUsed, res.easySteps, res.hardSteps, res.rounds)
    const stratOk = tgt.minStratBit === 0 || (res.strategiesUsed & tgt.minStratBit) !== 0
    const diffOk = stratOk && score >= tgt.minScore && score <= tgt.maxScore
      && res.easySteps + res.hardSteps >= tgt.minSteps
      && res.hardSteps >= tgt.minHardSteps
      && res.rounds >= tgt.minRounds
    if (diffOk) nPassDiff++
  }

  const nReached = nPassCorridor
  console.log(`  ${label.padEnd(7)} | grow ${fmt(totalGrowMs/100)} | solve ${fmt(nReached ? totalSolveMs/nReached : 0)} avg | boundary ${pct(nPassBoundary,100)} | corridor ${pct(nPassCorridor,100)} | solvable ${pct(nSolvable,100)} | diff pass ${pct(nPassDiff,100)}`)
}

// ── 3. Phase 2 (growBalanced): raw solvability + difficulty pass rate ────────
section('3. Phase 2: growBalanced — 100 attempts per difficulty')

for (const [label, levelNum] of [['easy', 2], ['medium', 6], ['hard', 12], ['expert', 18]] as const) {
  const tgt = targetDifficulty(levelNum)
  let nSolvable = 0, nPassDiff = 0, nPassBoundary = 0, nPassCorridor = 0
  let totalSolveMs = 0

  for (let i = 0; i < 100; i++) {
    const rng = makeRng(levelNum * 100003 + i * 6271 + 1_000_000)
    const cols = findPlacement(N, rng)
    const seeds = cols.map((c, r) => ({ r, c }))
    const grid = growBalanced(N, seeds, rng)

    const bc = boundaryCount(grid, N)
    if (bc < 40) continue
    nPassBoundary++
    if (hasCorridor(grid, N)) continue
    nPassCorridor++

    const t = performance.now()
    const res = canSolveLogically(grid, N)
    totalSolveMs += performance.now() - t

    if (!res.solved) continue
    nSolvable++

    const score = difficultyScore(res.strategiesUsed, res.easySteps, res.hardSteps, res.rounds)
    const stratOk = tgt.minStratBit === 0 || (res.strategiesUsed & tgt.minStratBit) !== 0
    const diffOk = stratOk && score >= tgt.minScore && score <= tgt.maxScore
      && res.easySteps + res.hardSteps >= tgt.minSteps
      && res.hardSteps >= tgt.minHardSteps
      && res.rounds >= tgt.minRounds
    if (diffOk) nPassDiff++
  }

  const nReached = nPassCorridor
  console.log(`  ${label.padEnd(7)} | solve ${fmt(nReached ? totalSolveMs/nReached : 0)} avg | boundary ${pct(nPassBoundary,100)} | corridor ${pct(nPassCorridor,100)} | solvable ${pct(nSolvable,100)} | diff pass ${pct(nPassDiff,100)}`)
}

// ── 4. Phase 0 (symmetric): solvability + difficulty pass rate ──────────────
section('4. Phase 0: growDiagonalSymmetric — 50 attempts per difficulty')

for (const [label, levelNum] of [['easy', 2], ['medium', 6], ['hard', 12], ['expert', 18]] as const) {
  const tgt = targetDifficulty(levelNum)
  let nSolvable = 0, nPassDiff = 0, nNoSymm = 0, nPassBoundary = 0, nPassSize = 0
  let totalMs = 0

  for (let i = 0; i < 50; i++) {
    const rng = makeRng(levelNum * 100003 + i * 7919 + 3_000_000)
    const symmCols = findSymmetricPlacement(N, rng)
    if (!symmCols) { nNoSymm++; continue }

    const t = performance.now()
    const grid = growDiagonalSymmetric(N, symmCols, rng)
    const bc = boundaryCount(grid, N)
    if (bc >= 40) nPassBoundary++
    if (bc >= 40 && maxRegionSize(grid, N) <= 22) nPassSize++

    if (bc < 40 || maxRegionSize(grid, N) > 22 || hasCorridor(grid, N)) {
      totalMs += performance.now() - t; continue
    }

    const res = canSolveLogically(grid, N)
    totalMs += performance.now() - t

    if (!res.solved) continue
    nSolvable++

    const score = difficultyScore(res.strategiesUsed, res.easySteps, res.hardSteps, res.rounds)
    const stratOk = tgt.minStratBit === 0 || (res.strategiesUsed & tgt.minStratBit) !== 0
    const diffOk = stratOk && score >= tgt.minScore && score <= tgt.maxScore
      && res.easySteps + res.hardSteps >= tgt.minSteps
      && res.hardSteps >= tgt.minHardSteps
      && res.rounds >= tgt.minRounds
    if (diffOk) nPassDiff++
  }

  console.log(`  ${label.padEnd(7)} | avg ${fmt(totalMs/50)} | no-symm ${pct(nNoSymm,50)} | boundary ${pct(nPassBoundary,50)} | size≤22 ${pct(nPassSize,50)} | solvable ${pct(nSolvable,50)} | diff pass ${pct(nPassDiff,50)}`)
}

// ── 5. Strategy breakdown on solvable Phase 1 layouts ───────────────────────
section('5. Strategy usage on solvable Phase 1 (growSizeBalanced) layouts')

{
  const stratNames: Record<number, string> = {
    1: 'singleton', 2: 'naked-subsets', 4: 'hidden-subsets',
    8: 'trap-2x2', 16: 'crowding', 32: 'forcing-chains',
    64: 'branch-rule', 128: 'x-wing', 256: 'symmetry'
  }
  const stratCounts: Record<number, number> = {}
  const BITS = [1, 2, 4, 8, 16, 32, 64, 128, 256]
  for (const b of BITS) stratCounts[b] = 0

  let nSolvable = 0
  const scores: number[] = []

  for (let i = 0; i < 200; i++) {
    const rng = makeRng(i * 6271 + 42)
    const cols = findPlacement(N, rng)
    const seeds = cols.map((c, r) => ({ r, c }))
    const grid = growSizeBalanced(N, seeds, rng)
    if (hasCorridor(grid, N)) continue
    const res = canSolveLogically(grid, N)
    if (!res.solved) continue
    nSolvable++
    const score = difficultyScore(res.strategiesUsed, res.easySteps, res.hardSteps, res.rounds)
    scores.push(score)
    for (const b of BITS) if (res.strategiesUsed & b) stratCounts[b]++
  }

  console.log(`  Solvable: ${nSolvable}/200`)
  if (nSolvable > 0) {
    const avg = scores.reduce((a, b) => a + b, 0) / scores.length
    const minS = Math.min(...scores), maxS = Math.max(...scores)
    console.log(`  Difficulty scores: avg=${avg.toFixed(1)} min=${minS} max=${maxS}`)
    console.log(`  Strategy hit rates (of solvable):`)
    for (const b of BITS) {
      console.log(`    ${stratNames[b].padEnd(16)} ${pct(stratCounts[b], nSolvable)}`)
    }
  }
}

// ── 6. Estimated worst-case generation time ──────────────────────────────────
section('6. Estimated worst-case generation time')

{
  // Measure one refineZones check (canSolveLogically call)
  const rng = makeRng(999)
  const cols = findPlacement(N, rng)
  const seeds = cols.map((c, r) => ({ r, c }))
  const grid = growSizeBalanced(N, seeds, rng)

  const t = performance.now()
  for (let i = 0; i < 20; i++) canSolveLogically(grid, N)
  const perCallMs = (performance.now() - t) / 20

  const phase0 = 300 * perCallMs
  const phase1 = 500 * (perCallMs + 80 * perCallMs)  // 1 check + up to 80 refine steps
  const phase2 = 500 * perCallMs
  const phase3 = 200 * perCallMs

  console.log(`  canSolveLogically avg: ${fmt(perCallMs)}`)
  console.log(`  Phase 0 worst case:    ${fmt(phase0)} (300 attempts)`)
  console.log(`  Phase 1 worst case:    ${fmt(phase1)} (500 × 81 checks)`)
  console.log(`  Phase 2 worst case:    ${fmt(phase2)} (500 checks)`)
  console.log(`  Phase 3 worst case:    ${fmt(phase3)} (200 checks)`)
  console.log(`  TOTAL worst case:      ${fmt(phase0 + phase1 + phase2 + phase3)}`)
  console.log(`  (assumes all phases fail — real time depends on pass rates above)`)
}

console.log('\n' + '─'.repeat(60))
console.log('  Done.')
console.log('─'.repeat(60) + '\n')
