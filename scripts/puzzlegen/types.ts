// One line of puzzles/pool/<tier>.jsonl. `code` is the v2 share code (all a
// client needs); the rest is the profile the puzzle was accepted on, kept so a
// tier's bar can be re-tightened later by re-filtering the pool instead of
// regenerating it.
export interface PoolEntry {
  code: string
  tier: 'hard' | 'expert'
  size: number
  seed: number
  counts: Record<string, number>
  required: string[]
  pairUse: number
  rounds: number
}
