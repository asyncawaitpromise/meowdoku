import { generateLevelByDifficulty } from './client/src/lib/levelGen/index'
import { canSolveLogically, difficultyScore, detectHalfTurnSymmetry } from './client/src/lib/levelGen/solver'
import { boundaryCount, sizeStdDev } from './client/src/lib/levelGen/growth'
import * as fs from 'fs'
import * as path from 'path'

interface PuzzleMetrics {
  N: number
  difficultyScore: number
  strategiesUsed: number
  easySteps: number
  hardSteps: number
  rounds: number
  minRegionSize: number
  maxRegionSize: number
  avgRegionSize: number
  stddevRegionSize: number
  boundaryCount: number
  halfTurnSymmetric: boolean
  solved: boolean
}

interface Stats {
  puzzles: PuzzleMetrics[]
  avgDifficultyScore: number
  avgRounds: number
  avgBoundaryCount: number
  strategyRates: Record<string, number>
  avgRegionSizes: { min: number; max: number; avg: number; stddev: number }
}

function getRegionSizes(regions: number[][], N: number): number[] {
  const sizes = Array(N).fill(0)
  for (let r = 0; r < N; r++) {
    for (let c = 0; c < N; c++) {
      sizes[regions[r][c]]++
    }
  }
  return sizes
}

function pad(s: string, width: number): string {
  return s.length >= width ? s : s + ' '.repeat(width - s.length)
}

function rpad(s: string, width: number): string {
  return s.length >= width ? s : ' '.repeat(width - s.length) + s
}

function computeStats(puzzles: PuzzleMetrics[]): Stats {
  const validPuzzles = puzzles.filter(p => p.solved)
  if (validPuzzles.length === 0) {
    return {
      puzzles: [],
      avgDifficultyScore: 0,
      avgRounds: 0,
      avgBoundaryCount: 0,
      strategyRates: {},
      avgRegionSizes: { min: 0, max: 0, avg: 0, stddev: 0 }
    }
  }

  const avgScore = validPuzzles.reduce((s, p) => s + p.difficultyScore, 0) / validPuzzles.length
  const avgRounds = validPuzzles.reduce((s, p) => s + p.rounds, 0) / validPuzzles.length
  const avgBC = validPuzzles.reduce((s, p) => s + p.boundaryCount, 0) / validPuzzles.length
  const avgMinSize = validPuzzles.reduce((s, p) => s + p.minRegionSize, 0) / validPuzzles.length
  const avgMaxSize = validPuzzles.reduce((s, p) => s + p.maxRegionSize, 0) / validPuzzles.length
  const avgAvgSize = validPuzzles.reduce((s, p) => s + p.avgRegionSize, 0) / validPuzzles.length
  const avgStddev = validPuzzles.reduce((s, p) => s + p.stddevRegionSize, 0) / validPuzzles.length

  const strategyRates: Record<string, number> = {}
  const strategies = ['singleton', 'naked', 'hidden', 'trap2x2', 'crowding', 'fc', 'branch', 'xwing', 'symprop', 'cn']
  const bits = [1, 2, 4, 8, 16, 32, 64, 128, 256, 512]
  for (let i = 0; i < strategies.length; i++) {
    const count = validPuzzles.filter(p => p.strategiesUsed & bits[i]).length
    strategyRates[strategies[i]] = count / validPuzzles.length
  }

  return {
    puzzles: validPuzzles,
    avgDifficultyScore: avgScore,
    avgRounds: avgRounds,
    avgBoundaryCount: avgBC,
    strategyRates,
    avgRegionSizes: { min: avgMinSize, max: avgMaxSize, avg: avgAvgSize, stddev: avgStddev }
  }
}

async function generateOurPuzzles(): Promise<{ easy7: PuzzleMetrics[]; medium7: PuzzleMetrics[] }> {
  const easy7: PuzzleMetrics[] = []
  const medium7: PuzzleMetrics[] = []

  console.log('Generating Easy 7x7 puzzles (10 attempts)...')
  for (let i = 0; i < 10; i++) {
    const level = generateLevelByDifficulty('easy', { puzzleIndex: i, globalSeed: 0 })
    if (!level) continue

    const N = level.regions.length
    if (N !== 7) continue

    const regionSizes = getRegionSizes(level.regions, N)
    const solve = canSolveLogically(level.regions, N)

    const metrics: PuzzleMetrics = {
      N,
      difficultyScore: difficultyScore(solve.strategiesUsed, solve.easySteps, solve.hardSteps, solve.rounds),
      strategiesUsed: solve.strategiesUsed,
      easySteps: solve.easySteps,
      hardSteps: solve.hardSteps,
      rounds: solve.rounds,
      minRegionSize: Math.min(...regionSizes),
      maxRegionSize: Math.max(...regionSizes),
      avgRegionSize: regionSizes.reduce((a, b) => a + b) / N,
      stddevRegionSize: sizeStdDev(level.regions, N),
      boundaryCount: boundaryCount(level.regions, N),
      halfTurnSymmetric: detectHalfTurnSymmetry(level.regions, N),
      solved: solve.solved
    }
    easy7.push(metrics)
  }

  console.log(`Generated ${easy7.length} easy puzzles.`)

  console.log('Generating Medium 7x7 puzzles (10 attempts)...')
  for (let i = 0; i < 10; i++) {
    const level = generateLevelByDifficulty('medium', { puzzleIndex: i, globalSeed: 0 })
    if (!level) continue

    const N = level.regions.length
    if (N !== 7) continue

    const regionSizes = getRegionSizes(level.regions, N)
    const solve = canSolveLogically(level.regions, N)

    const metrics: PuzzleMetrics = {
      N,
      difficultyScore: difficultyScore(solve.strategiesUsed, solve.easySteps, solve.hardSteps, solve.rounds),
      strategiesUsed: solve.strategiesUsed,
      easySteps: solve.easySteps,
      hardSteps: solve.hardSteps,
      rounds: solve.rounds,
      minRegionSize: Math.min(...regionSizes),
      maxRegionSize: Math.max(...regionSizes),
      avgRegionSize: regionSizes.reduce((a, b) => a + b) / N,
      stddevRegionSize: sizeStdDev(level.regions, N),
      boundaryCount: boundaryCount(level.regions, N),
      halfTurnSymmetric: detectHalfTurnSymmetry(level.regions, N),
      solved: solve.solved
    }
    medium7.push(metrics)
  }

  console.log(`Generated ${medium7.length} medium puzzles.`)

  return { easy7, medium7 }
}

function parseExternalPuzzles(filePath: string): PuzzleMetrics[] {
  const data = JSON.parse(fs.readFileSync(filePath, 'utf-8'))
  const results: PuzzleMetrics[] = []

  for (const puzzle of data.puzzles) {
    const [id, flatGrid, solution] = puzzle
    const N = Math.sqrt(flatGrid.length)

    if (!Number.isInteger(N)) continue

    const regions: number[][] = []
    for (let r = 0; r < N; r++) {
      const row: number[] = []
      for (let c = 0; c < N; c++) {
        row.push(flatGrid[r * N + c])
      }
      regions.push(row)
    }

    const solve = canSolveLogically(regions, N)
    const regionSizes = getRegionSizes(regions, N)

    const metrics: PuzzleMetrics = {
      N,
      difficultyScore: difficultyScore(solve.strategiesUsed, solve.easySteps, solve.hardSteps, solve.rounds),
      strategiesUsed: solve.strategiesUsed,
      easySteps: solve.easySteps,
      hardSteps: solve.hardSteps,
      rounds: solve.rounds,
      minRegionSize: Math.min(...regionSizes),
      maxRegionSize: Math.max(...regionSizes),
      avgRegionSize: regionSizes.reduce((a, b) => a + b) / N,
      stddevRegionSize: sizeStdDev(regions, N),
      boundaryCount: boundaryCount(regions, N),
      halfTurnSymmetric: detectHalfTurnSymmetry(regions, N),
      solved: solve.solved
    }
    results.push(metrics)
  }

  return results
}

function fmt(n: number, w: number): string {
  return rpad(n.toFixed(2), w)
}

async function main() {
  console.log('=== MEOWDOKU PUZZLE QUALITY COMPARISON ===\n')

  console.log('Generating our puzzles...')
  const ourGen = await generateOurPuzzles()

  console.log('\nParsing external puzzle sets...')
  const ext1Path = path.join(process.cwd(), 'external-resources', 'puzzles1')
  const ext2Path = path.join(process.cwd(), 'external-resources', 'puzzles2')

  const ext1Metrics = parseExternalPuzzles(ext1Path)
  const ext2Metrics = parseExternalPuzzles(ext2Path)

  const ext1Stats = computeStats(ext1Metrics)
  const ext2Stats = computeStats(ext2Metrics)

  const ourEasyStats = computeStats(ourGen.easy7)
  const ourMediumStats = computeStats(ourGen.medium7)

  console.log('\n' + '='.repeat(120))
  console.log('PUZZLE QUALITY COMPARISON TABLE')
  console.log('='.repeat(120) + '\n')

  if (ourEasyStats.puzzles.length > 0 && ext1Stats.puzzles.length > 0) {
    console.log('7×7 EASY/MEDIUM PUZZLES (Our Generated vs External Tier-2)')
    console.log('-'.repeat(120))
    console.log(`Metric                          | Our Easy | Our Medium | External T2 |  Delta(E)  |  Delta(M)`)
    console.log('-'.repeat(120))

    const row = (label: string, our_easy: number, our_med: number, ext: number) => {
      const deltaE = our_easy - ext
      const deltaM = our_med - ext
      console.log(`${pad(label, 31)} | ${fmt(our_easy, 8)} | ${fmt(our_med, 10)} | ${fmt(ext, 11)} | ${fmt(deltaE, 10)} | ${fmt(deltaM, 9)}`)
    }

    row('Avg Difficulty Score',
      ourEasyStats.avgDifficultyScore, ourMediumStats.avgDifficultyScore, ext1Stats.avgDifficultyScore)
    row('Avg Rounds',
      ourEasyStats.avgRounds, ourMediumStats.avgRounds, ext1Stats.avgRounds)
    row('Avg Boundary Count',
      ourEasyStats.avgBoundaryCount, ourMediumStats.avgBoundaryCount, ext1Stats.avgBoundaryCount)
    row('Avg Min Region Size',
      ourEasyStats.avgRegionSizes.min, ourMediumStats.avgRegionSizes.min, ext1Stats.avgRegionSizes.min)
    row('Avg Max Region Size',
      ourEasyStats.avgRegionSizes.max, ourMediumStats.avgRegionSizes.max, ext1Stats.avgRegionSizes.max)
    row('Avg Region Size (mean)',
      ourEasyStats.avgRegionSizes.avg, ourMediumStats.avgRegionSizes.avg, ext1Stats.avgRegionSizes.avg)
    row('Avg Region Size StdDev',
      ourEasyStats.avgRegionSizes.stddev, ourMediumStats.avgRegionSizes.stddev, ext1Stats.avgRegionSizes.stddev)

    console.log('-'.repeat(120))
    console.log(`Strategy Usage Rates (% of puzzles) | Our Easy | Our Medium | External T2`)
    console.log('-'.repeat(120))

    for (const strat of Object.keys(ourEasyStats.strategyRates)) {
      const our_e = (ourEasyStats.strategyRates[strat] * 100).toFixed(1)
      const our_m = (ourMediumStats.strategyRates[strat] * 100).toFixed(1)
      const ext = (ext1Stats.strategyRates[strat] * 100).toFixed(1)
      console.log(`  ${pad(strat, 28)} | ${rpad(our_e + '%', 8)} | ${rpad(our_m + '%', 10)} | ${rpad(ext + '%', 11)}`)
    }
  }

  console.log('\n')

  if (ext2Stats.puzzles.length > 0) {
    console.log('10×10 EXTERNAL TIER-3 PUZZLES (Reference Data for Expert Difficulty)')
    console.log('-'.repeat(120))
    console.log(`Metric                          | Value`)
    console.log('-'.repeat(120))
    console.log(`Sample Size                     | ${ext2Stats.puzzles.length} puzzles`)
    console.log(`Avg Difficulty Score            | ${ext2Stats.avgDifficultyScore.toFixed(2)}`)
    console.log(`Avg Rounds                      | ${ext2Stats.avgRounds.toFixed(2)}`)
    console.log(`Avg Boundary Count              | ${ext2Stats.avgBoundaryCount.toFixed(2)}`)
    console.log(`Avg Min Region Size             | ${ext2Stats.avgRegionSizes.min.toFixed(2)}`)
    console.log(`Avg Max Region Size             | ${ext2Stats.avgRegionSizes.max.toFixed(2)}`)
    console.log(`Avg Region Size (mean)          | ${ext2Stats.avgRegionSizes.avg.toFixed(2)}`)
    console.log(`Avg Region Size StdDev          | ${ext2Stats.avgRegionSizes.stddev.toFixed(2)}`)
    console.log(`Half-turn Symmetric             | ${(ext2Stats.puzzles.filter(p => p.halfTurnSymmetric).length / ext2Stats.puzzles.length * 100).toFixed(1)}%`)
    console.log('-'.repeat(120))
    console.log(`Strategy Usage Rates (% of puzzles)`)
    console.log('-'.repeat(120))
    for (const strat of Object.keys(ext2Stats.strategyRates)) {
      console.log(`  ${pad(strat, 28)} | ${(ext2Stats.strategyRates[strat] * 100).toFixed(1)}%`)
    }
  }

  console.log('\n' + '='.repeat(120))
  console.log('SUMMARY')
  console.log('='.repeat(120))
  console.log(`Our 7x7 Easy:    ${ourGen.easy7.length} puzzles generated, ${ourEasyStats.puzzles.length} solved`)
  console.log(`Our 7x7 Medium:  ${ourGen.medium7.length} puzzles generated, ${ourMediumStats.puzzles.length} solved`)
  console.log(`External Tier-2: ${ext1Stats.puzzles.length} puzzles (7x7)`)
  console.log(`External Tier-3: ${ext2Stats.puzzles.length} puzzles (10x10)`)
  console.log('='.repeat(120) + '\n')
}

main().catch(console.error)
