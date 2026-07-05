// test_metrics.mjs — validate easySteps, hardSteps, boundaries, and difficulty metrics
// Run: node --import tsx/esm test_metrics.mjs

import { generateLevel } from './client/src/lib/levelGen.ts'

const LEVELS = [1, 3, 5, 8, 12, 16, 20]
const SEEDS  = [0, 1, 2, 3, 4]

function pad(val, w) { return String(val).padStart(w) }
function avg(arr) { return arr.reduce((a, b) => a + b, 0) / arr.length }

// ── per-level accumulator ────────────────────────────────────────────────────
const stats = {}
for (const lv of LEVELS) stats[lv] = { easy: [], hard: [], bounds: [], diffs: [] }

// ── header ───────────────────────────────────────────────────────────────────
console.log('\nGenerating levels...\n')
const COL_W = [6, 5, 11, 10, 10, 11]
const headers = ['level', 'seed', 'difficulty', 'easySteps', 'hardSteps', 'boundaries']
console.log(headers.map((h, i) => pad(h, COL_W[i])).join('  '))
console.log(COL_W.map(w => '-'.repeat(w)).join('  '))

// ── main loop ────────────────────────────────────────────────────────────────
for (const levelNum of LEVELS) {
  for (const seed of SEEDS) {
    const lvl = generateLevel(levelNum, seed)

    const row = [
      levelNum,
      seed,
      lvl.difficulty.toFixed(1),
      lvl.easySteps,
      lvl.hardSteps,
      lvl.boundaries,
    ]
    console.log(row.map((v, i) => pad(v, COL_W[i])).join('  '))

    stats[levelNum].easy.push(lvl.easySteps)
    stats[levelNum].hard.push(lvl.hardSteps)
    stats[levelNum].bounds.push(lvl.boundaries)
    stats[levelNum].diffs.push(lvl.difficulty)
  }
}

// ── summary ──────────────────────────────────────────────────────────────────
console.log('\n── Per-level summary ──────────────────────────────────────────────────────')
const SH = ['level', 'avgDiff', 'minDiff', 'maxDiff', 'avgEasy', 'avgHard', 'minHard', 'maxHard', 'avgBound', 'minBound', 'maxBound']
const SW  = [6, 8, 8, 8, 8, 8, 8, 8, 9, 9, 9]
console.log(SH.map((h, i) => pad(h, SW[i])).join('  '))
console.log(SW.map(w => '-'.repeat(w)).join('  '))

for (const lv of LEVELS) {
  const { easy, hard, bounds, diffs } = stats[lv]
  const row = [
    lv,
    avg(diffs).toFixed(1),
    Math.min(...diffs).toFixed(1),
    Math.max(...diffs).toFixed(1),
    Math.round(avg(easy)),
    Math.round(avg(hard)),
    Math.min(...hard),
    Math.max(...hard),
    Math.round(avg(bounds)),
    Math.min(...bounds),
    Math.max(...bounds),
  ]
  console.log(row.map((v, i) => pad(v, SW[i])).join('  '))
}

// ── sanity checks ─────────────────────────────────────────────────────────────
console.log('\n── Sanity checks ─────────────────────────────────────────────────────────')

let allPass = true

// 1. Fallback detection: difficulty === 0 means Voronoi fallback
console.log()
let anyFallback = false
for (const lv of LEVELS) {
  const fallbacks = stats[lv].diffs.filter(d => d === 0).length
  if (fallbacks > 0) {
    anyFallback = true
    allPass = false
    console.log(`  FALLBACK (difficulty=0) for level ${String(lv).padEnd(2)}: ${fallbacks}/5 seeds`)
  }
}
if (!anyFallback) console.log('  No Voronoi fallbacks (difficulty=0): PASS')

// 2. hardSteps thresholds per tier
console.log()
const tiers = [
  { name: 'medium (5–8)',   levels: [5, 8],      minHard: 5  },
  { name: 'hard   (12–15)', levels: [12],         minHard: 15 },
  { name: 'expert (16+)',   levels: [16, 20],     minHard: 30 },
]
for (const { name, levels, minHard } of tiers) {
  const allHard = levels.flatMap(lv => stats[lv]?.hard ?? [])
  const belowThreshold = allHard.filter(h => h < minHard)
  const pass = belowThreshold.length === 0
  if (!pass) allPass = false
  console.log(`  hardSteps >= ${String(minHard).padEnd(2)} for ${name}: ${pass ? 'PASS' : `FAIL (${belowThreshold.length}/${allHard.length} below threshold)`}`)
}

// 3. easySteps + hardSteps > 0 for all puzzles
console.log()
for (const lv of LEVELS) {
  const zeros = stats[lv].easy.map((e, i) => e + stats[lv].hard[i]).filter(t => t === 0).length
  if (zeros > 0) {
    allPass = false
    console.log(`  totalSteps=0 for level ${String(lv).padEnd(2)}: FAIL (${zeros}/5 seeds)`)
  } else {
    const minTotal = Math.min(...stats[lv].easy.map((e, i) => e + stats[lv].hard[i]))
    const maxTotal = Math.max(...stats[lv].easy.map((e, i) => e + stats[lv].hard[i]))
    console.log(`  totalSteps for level ${String(lv).padEnd(2)}: PASS all > 0 (range ${minTotal}–${maxTotal})`)
  }
}

// 4. Difficulty trend
console.log()
const avgs = LEVELS.map(lv => avg(stats[lv].diffs))
let diffOk = true
for (let i = 1; i < LEVELS.length; i++) {
  if (avgs[i] < avgs[i - 1] - 3) { diffOk = false; break }
}
console.log(`  avg difficulty trend (${avgs.map(v => v.toFixed(1)).join(' → ')}):`)
console.log(`    ${diffOk ? 'PASS (generally non-decreasing)' : 'WARN (not monotonically increasing)'}`)

// 5. easySteps vs hardSteps direction check
console.log()
const easyAvgs = LEVELS.map(lv => avg(stats[lv].easy))
const hardAvgs = LEVELS.map(lv => avg(stats[lv].hard))
// Easy levels should have low hardSteps
const earlyHardOk = hardAvgs[0] <= 5 && hardAvgs[1] <= 5  // levels 1, 3
// Hard/expert levels should have meaningful hardSteps
const lateHardOk = hardAvgs[LEVELS.indexOf(12)] >= 15 && hardAvgs[LEVELS.indexOf(16)] >= 30
console.log(`  easySteps trend: ${easyAvgs.map((v, i) => `L${LEVELS[i]}=${Math.round(v)}`).join(', ')}`)
console.log(`  hardSteps trend: ${hardAvgs.map((v, i) => `L${LEVELS[i]}=${Math.round(v)}`).join(', ')}`)
console.log(`  Easy levels (1,3) have low hardSteps: ${earlyHardOk ? 'PASS' : 'WARN'}`)
console.log(`  Hard/expert levels have meaningful hardSteps: ${lateHardOk ? 'PASS' : 'WARN'}`)

console.log(`\nOverall: ${allPass ? 'ALL CHECKS PASSED' : 'SOME CHECKS FAILED — see above'}\n`)
