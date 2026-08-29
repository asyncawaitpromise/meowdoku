// Ad-hoc quality-comparison report: generates a batch of real puzzles through
// the full generateLevel pipeline and prints the same aggregate stats used to
// profile external-resources/ (see the "external-reference-profile" memory
// doc), so generator changes can be checked against that calibration target
// without re-deriving the comparison from scratch each time.
//
// Not part of `test`/`test:bench` — each sample can take up to a minute at
// hard/expert tiers, so a meaningful batch is a many-minute, manual-only run.
//
// Usage: npx tsx scripts/qualityReport.ts <levelNum> <count> [outFile]
//   e.g. npx tsx scripts/qualityReport.ts 18 25 /tmp/expert.json
import { writeFileSync } from 'fs'
import { generateLevel, boundaryCount, sizeStdDev } from '../client/src/lib/levelGen/index'

const levelNum = Number(process.argv[2] || 18)
const count = Number(process.argv[3] || 20)
const outFile = process.argv[4]

type Row = {
  seed: number; size: number; gateMet: boolean; difficulty: number
  boundaryCount: number; regionSizeStdDev: number; deductionStepCount: number
  easySteps: number; hardSteps: number; rounds: number; maxSubsetSize: number
  symmetric: boolean; techniqueCounts: Record<string, number>
}

function fmt(n: number, d = 1) { return n.toFixed(d) }
function mean(xs: number[]) { return xs.reduce((a, b) => a + b, 0) / xs.length }

const rows: Row[] = []
const t0 = Date.now()

for (let seed = 0; seed < count; seed++) {
  const seedT0 = Date.now()
  const level = generateLevel(levelNum, seed)
  const bc = boundaryCount(level.regions, level.size)
  const sd = sizeStdDev(level.regions, level.size)
  const row: Row = {
    seed, size: level.size, gateMet: level.gateMet, difficulty: level.difficulty,
    boundaryCount: bc, regionSizeStdDev: sd, deductionStepCount: level.easySteps + level.hardSteps,
    easySteps: level.easySteps, hardSteps: level.hardSteps, rounds: level.rounds,
    maxSubsetSize: level.maxSubsetSize, symmetric: level.symmetric, techniqueCounts: level.techniqueCounts,
  }
  rows.push(row)
  console.log(`seed ${seed}: size=${row.size} gateMet=${row.gateMet} bc=${bc} sd=${fmt(sd, 2)} steps=${row.deductionStepCount} time=${fmt((Date.now() - seedT0) / 1000)}s`)
  if (outFile) writeFileSync(outFile, JSON.stringify(rows, null, 2))
}

console.log(`\nTotal: ${fmt((Date.now() - t0) / 1000)}s for ${rows.length} samples (levelNum=${levelNum})\n`)

// Group by size since pickSize can draw an off-tier board (e.g. N=8/11).
const bySize = new Map<number, Row[]>()
for (const r of rows) {
  if (!bySize.has(r.size)) bySize.set(r.size, [])
  bySize.get(r.size)!.push(r)
}

for (const [size, group] of [...bySize.entries()].sort((a, b) => a[0] - b[0])) {
  const gateMetRows = group.filter(r => r.gateMet)
  const fallbackRows = group.filter(r => !r.gateMet)
  console.log(`=== N=${size} (n=${group.length}, gateMet rate ${fmt(100 * gateMetRows.length / group.length, 1)}%) ===`)

  const block = (label: string, rs: Row[]) => {
    if (rs.length === 0) { console.log(`  ${label}: (none)`); return }
    const bcs = rs.map(r => r.boundaryCount), sds = rs.map(r => r.regionSizeStdDev), steps = rs.map(r => r.deductionStepCount)
    console.log(`  ${label} (n=${rs.length}): boundaryCount mean=${fmt(mean(bcs))} range=${Math.min(...bcs)}-${Math.max(...bcs)}` +
      ` | regionSizeStdDev mean=${fmt(mean(sds), 2)} range=${fmt(Math.min(...sds), 2)}-${fmt(Math.max(...sds), 2)}` +
      ` | steps mean=${fmt(mean(steps))} range=${Math.min(...steps)}-${Math.max(...steps)}`)
    const techHits: Record<string, number> = {}
    for (const r of rs) for (const k of Object.keys(r.techniqueCounts)) techHits[k] = (techHits[k] ?? 0) + 1
    const rates = Object.entries(techHits).sort((a, b) => b[1] - a[1])
      .map(([k, v]) => `${k}:${fmt(100 * v / rs.length, 0)}%`).join(' ')
    console.log(`    technique presence: ${rates}`)
  }
  block('gateMet=true', gateMetRows)
  block('gateMet=false (fallback)', fallbackRows)
  console.log()
}
