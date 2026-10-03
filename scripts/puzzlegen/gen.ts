// Pre-generates hard/expert puzzles with a worker-thread pool and appends the
// accepted ones to puzzles/pool/<tier>.jsonl (deduped by share code).
//
//   pnpm puzzles:gen -- <hard|expert> [--count 50] [--workers 8] [--steps 400] [--minutes 30]
import { Worker } from 'node:worker_threads'
import { appendFileSync, existsSync, mkdirSync, readFileSync } from 'node:fs'
import { cpus } from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import type { PoolEntry } from './types'

const here = path.dirname(fileURLToPath(import.meta.url))
const root = path.resolve(here, '../..')

const args = process.argv.slice(2).filter(a => a !== '--')
const tier = args[0] as 'hard' | 'expert'
if (tier !== 'hard' && tier !== 'expert') { console.error('usage: gen <hard|expert> [--count n] [--workers n] [--steps n] [--minutes n]'); process.exit(1) }
const flag = (name: string, dflt: number) => { const i = args.indexOf(`--${name}`); return i >= 0 ? Number(args[i + 1]) : dflt }
const count = flag('count', 50)
const workers = flag('workers', Math.max(1, cpus().length - 1))
const steps = flag('steps', 400)
const minutes = flag('minutes', 0)

const poolFile = path.join(root, 'puzzles/pool', `${tier}.jsonl`)
mkdirSync(path.dirname(poolFile), { recursive: true })
const seen = new Set<string>()
let existing = 0
if (existsSync(poolFile)) {
  for (const line of readFileSync(poolFile, 'utf-8').split('\n')) {
    if (!line.trim()) continue
    seen.add((JSON.parse(line) as PoolEntry).code); existing++
  }
}
// Continue after the highest seed already used so reruns explore new starts.
let seedBase = 1000
if (existing > 0) {
  for (const line of readFileSync(poolFile, 'utf-8').split('\n')) if (line.trim()) seedBase = Math.max(seedBase, (JSON.parse(line) as PoolEntry).seed + 1)
  seedBase += workers * 1000
}

let found = 0, attempts = 0
const t0 = Date.now()
const pool: Worker[] = []
const done = () => { pool.forEach(w => w.terminate()); console.log(`done: +${found} (pool ${existing + found}) from ${attempts} starts in ${((Date.now() - t0) / 1000).toFixed(0)}s`); process.exit(0) }

for (let i = 0; i < workers; i++) {
  const w = new Worker(new URL('./worker.ts', import.meta.url), {
    workerData: { tier, workerId: i, workers, stepsPerStart: steps, seedBase },
    execArgv: ['--import', 'tsx'],
  })
  w.on('message', (m: { type: string; entry?: PoolEntry }) => {
    if (m.type === 'attempt') { attempts++; return }
    const e = m.entry!
    if (seen.has(e.code)) return
    seen.add(e.code); found++
    appendFileSync(poolFile, JSON.stringify(e) + '\n')
    console.log(`+${found} size=${e.size} pairUse=${e.pairUse} required=[${e.required}] counts=${JSON.stringify(e.counts)} (${attempts} starts, ${((Date.now() - t0) / 1000).toFixed(0)}s)`)
    if (found >= count) done()
  })
  w.on('error', err => { console.error('worker error', err) })
  pool.push(w)
}
if (minutes > 0) setTimeout(done, minutes * 60_000)
