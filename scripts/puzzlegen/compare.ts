// Scores the external reference puzzle sets and our pool against the same tier
// specs, so "ours should be better" is a measurement rather than a feeling.
//   pnpm tsx scripts/puzzlegen/compare.ts
import { readFileSync, existsSync } from 'node:fs'
import { profilePuzzle, type PuzzleProfile } from '../../client/src/lib/levelGen/solver/profile'
import { TIERS } from '../../client/src/lib/levelGen/search/tiers'
import { decodeShareCode, hasCorridor, maxRegionSize, sizeStdDev, boundaryCount } from '../../client/src/lib/levelGen/index'

interface Shape { N: number; regions: number[][] }

function shapeRow(label: string, shapes: Shape[]) {
  const n = shapes.length
  if (!n) return
  const avg = (f: (s: Shape) => number) => (shapes.reduce((a, s) => a + f(s), 0) / n).toFixed(1)
  const frac = (s: Shape) => boundaryCount(s.regions, s.N) / (2 * s.N * (s.N - 1))
  console.log(`  layout ${label.padEnd(15)} corridor ${Math.round(100 * shapes.filter(s => hasCorridor(s.regions, s.N)).length / n)}% | max region ${avg(s => maxRegionSize(s.regions, s.N))} | size stddev ${avg(s => sizeStdDev(s.regions, s.N))} | boundary density ${(shapes.reduce((a, s) => a + frac(s), 0) / n).toFixed(2)}`)
}

function row(label: string, profiles: PuzzleProfile[]) {
  const n = profiles.length
  if (!n) return
  const pct = (f: (p: PuzzleProfile) => boolean) => `${Math.round(100 * profiles.filter(f).length / n)}%`
  const avg = (f: (p: PuzzleProfile) => number) => (profiles.reduce((a, p) => a + f(p), 0) / n).toFixed(1)
  console.log(
    `${label.padEnd(22)} n=${String(n).padStart(3)} | hard-spec ${pct(TIERS.hard.accepts).padStart(4)} expert-spec ${pct(TIERS.expert.accepts).padStart(4)}` +
    ` | needsHyp ${pct(p => p.required.includes('hypothesis')).padStart(4)} forcing ${pct(p => (p.counts['forcing-chain'] ?? 0) > 0).padStart(4)}` +
    ` branch ${pct(p => (p.counts.branch ?? 0) > 0).padStart(4)} | avg pairUse ${avg(p => p.pairUse).padStart(5)} rounds ${avg(p => p.rounds).padStart(5)}`)
}

for (const f of ['puzzles1', 'puzzles2', 'puzzles3-hard']) {
  const raw = JSON.parse(readFileSync(`external-resources/${f}`, 'utf-8'))
  const N = raw.size
  const shapes: Shape[] = raw.puzzles.map((p: any) => ({ N, regions: Array.from({ length: N }, (_, r) => (p[1] as number[]).slice(r * N, r * N + N)) }))
  row(`external ${f}`, shapes.map(s => profilePuzzle(s.regions, s.N)))
  shapeRow(f, shapes)
}
// Ours: the published files, i.e. exactly what a client decodes.
for (const tier of ['hard', 'expert']) {
  const f = `client/public/puzzles/${tier}.txt`
  if (!existsSync(f)) continue
  const shapes: Shape[] = readFileSync(f, 'utf-8').split('\n').filter(Boolean).map(c => { const l = decodeShareCode(c)!; return { N: l.size, regions: l.regions } })
  row(`ours ${tier}`, shapes.map(s => profilePuzzle(s.regions, s.N)))
  shapeRow(`ours ${tier}`, shapes)
}
