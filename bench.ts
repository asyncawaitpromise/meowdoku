// Diagnostic benchmark — run with: npx tsx bench.ts
// Tests each generation component independently so we can see where time goes.

import {
  makeRng, findPlacement, findSymmetricPlacement,
  canSolveLogically, canSolveFast,
  growVoronoi, growSizeBalanced, growConstrainedSections, growBalanced, growDiagonalSymmetric,
  boundaryCount, hasCorridor, maxRegionSize,
  difficultyScore, targetDifficulty,
} from './client/src/lib/levelGen/index.ts'

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

// ── 2b. NEW Phase 1 (growConstrainedSections): raw solvability ───────────────
section('2b. NEW Phase 1: growConstrainedSections — 100 attempts per difficulty')

for (const [label, levelNum] of [['easy', 2], ['medium', 6], ['hard', 12], ['expert', 18]] as const) {
  const tgt = targetDifficulty(levelNum)
  let nSolvable = 0, nPassDiff = 0, nNull = 0, nPassBoundary = 0, nPassCorridor = 0
  let totalSolveMs = 0
  const stratCounts: Record<number, number> = {}
  for (const b of [1,2,4,8,16,32,64,128,256]) stratCounts[b] = 0

  for (let i = 0; i < 100; i++) {
    const rng = makeRng(levelNum * 100003 + i * 6271)
    const cols = findPlacement(N, rng)
    const seeds = cols.map((c, r) => ({ r, c }))
    const grid = growConstrainedSections(N, seeds, rng)
    if (grid === null) { nNull++; continue }

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
    for (const b of [1,2,4,8,16,32,64,128,256]) if (res.strategiesUsed & b) stratCounts[b]++

    const score = difficultyScore(res.strategiesUsed, res.easySteps, res.hardSteps, res.rounds)
    const stratOk = tgt.minStratBit === 0 || (res.strategiesUsed & tgt.minStratBit) !== 0
    const diffOk = stratOk && score >= tgt.minScore && score <= tgt.maxScore
      && res.easySteps + res.hardSteps >= tgt.minSteps
      && res.hardSteps >= tgt.minHardSteps
      && res.rounds >= tgt.minRounds
    if (diffOk) nPassDiff++
  }

  const nReached = nPassCorridor
  console.log(`  ${label.padEnd(7)} | null ${pct(nNull,100)} | solve ${fmt(nReached ? totalSolveMs/nReached : 0)} avg | solvable ${pct(nSolvable,100)} | diff pass ${pct(nPassDiff,100)}`)
  if (nSolvable > 0) {
    const stratNames: Record<number, string> = {1:'sing',2:'naked',4:'hidden',8:'trap',16:'crowd',32:'fc',64:'branch',128:'xwing',256:'symm'}
    const hits = [1,2,4,8,16,32,64,128,256].filter(b => stratCounts[b] > 0).map(b => `${stratNames[b]}:${pct(stratCounts[b],nSolvable)}`).join(' ')
    console.log(`    strategies: ${hits}`)
  }
}

// ── 3. Phase 3 (growBalanced): raw solvability + difficulty pass rate ─────────
section('3. Phase 3: growBalanced — 100 attempts per difficulty')

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
section('6. Estimated worst-case generation time (reflects current code)')

{
  // Measure solver cost on Phase 1 layouts (more representative than Voronoi)
  const layouts: number[][][] = []
  for (let i = 0; i < 30; i++) {
    const rng = makeRng(i * 6271 + 77)
    const cols = findPlacement(N, rng)
    const seeds = cols.map((c, r) => ({ r, c }))
    layouts.push(growSizeBalanced(N, seeds, rng))
  }

  let slowTotal = 0, fastTotal = 0
  for (const g of layouts) {
    const t1 = performance.now(); canSolveLogically(g, N); slowTotal += performance.now() - t1
    const t2 = performance.now(); canSolveFast(g, N);      fastTotal += performance.now() - t2
  }
  const slowMs = slowTotal / 30
  const fastMs = fastTotal / 30

  // With canSolveFast gate: 98% of refine steps only pay fastMs (fast returns false),
  // 2% pay fastMs + slowMs (fast passes, slow confirms). Effective cost per step:
  const gatedMs = 0.98 * fastMs + 0.02 * (fastMs + slowMs)

  const phase0 = 10 * slowMs          // 10 attempts (reduced from 300)
  const phase1 = 500 * (slowMs + 80 * gatedMs)  // 1 direct check + 80 gated refine steps
  const phase2 = 500 * slowMs
  const phase3 = 200 * slowMs

  console.log(`  canSolveLogically on P1 layouts: ${fmt(slowMs)}`)
  console.log(`  canSolveFast on P1 layouts:      ${fmt(fastMs)}`)
  console.log(`  gated refine step cost:          ${fmt(gatedMs)} (vs ${fmt(slowMs)} ungated)`)
  console.log(`  Phase 0 worst case: ${fmt(phase0)} (10 attempts, was 300)`)
  console.log(`  Phase 1 worst case: ${fmt(phase1)} (500 × 81 checks, refine gated)`)
  console.log(`  Phase 2 worst case: ${fmt(phase2)} (500 checks)`)
  console.log(`  Phase 3 worst case: ${fmt(phase3)} (200 checks)`)
  console.log(`  TOTAL worst case:   ${fmt(phase0 + phase1 + phase2 + phase3)}`)
  console.log(`  (assumes all phases fail; mobile 3–5× slower)`)
}

console.log('\n' + '─'.repeat(60))
console.log('  Done.')
console.log('─'.repeat(60) + '\n')
