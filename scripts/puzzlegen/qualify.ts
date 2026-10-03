import { existsSync, readFileSync } from 'node:fs'
import path from 'node:path'
import { decodeShareCode } from '../../client/src/lib/levelGen/index'
import { profilePuzzle } from '../../client/src/lib/levelGen/solver/profile'
import { TIERS } from '../../client/src/lib/levelGen/search/tiers'
import type { PoolEntry } from './types'

export const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), '../..')
export type Tier = 'hard' | 'expert'
export const TIER_NAMES: Tier[] = ['hard', 'expert']

// The pool entries that clear a tier's *current* bar, in pool (append) order. Each one is
// re-profiled from its share code — what a client will actually decode — rather than
// trusting the stats stored at generation time.
export function loadQualifying(tier: Tier): { entries: PoolEntry[]; total: number } | null {
  const file = path.join(root, 'puzzles/pool', `${tier}.jsonl`)
  if (!existsSync(file)) return null
  const all = readFileSync(file, 'utf-8').split('\n').filter(Boolean).map(l => JSON.parse(l) as PoolEntry)
  const spec = TIERS[tier]
  const entries = all.filter(e => {
    const level = decodeShareCode(e.code)
    if (!level || level.size < spec.minSize) return false
    return spec.layoutAccepts(level.regions, level.size) && spec.accepts(profilePuzzle(level.regions, level.size))
  })
  return { entries, total: all.length }
}
