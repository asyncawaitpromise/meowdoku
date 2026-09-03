import { describe, it, expect } from 'vitest'
import { generateLevelByDifficulty } from '../../client/src/lib/levelGen'

// Co-op mode derives the same shared board on both participants' devices from
// the session's (difficulty, puzzleSeed) using a single deterministic worker
// stream (see levelGenCoordinator's GenOptions.maxWorkers). If generation were
// stateful or timing-dependent, the two clients could produce different
// regions/colors/solutions and the shared board would be meaningless — these
// tests pin the determinism of the exact stream co-op uses (salt 0, budget 1).
const SESSION_LIKE = { difficulty: 'medium', puzzleSeed: 123456 } as const

describe('deterministic generation (co-op shared board)', () => {
  it('produces byte-identical levels for the same difficulty/seed args', () => {
    const a = generateLevelByDifficulty(SESSION_LIKE.difficulty, 1, SESSION_LIKE.puzzleSeed)
    const b = generateLevelByDifficulty(SESSION_LIKE.difficulty, 1, SESSION_LIKE.puzzleSeed)
    expect(JSON.stringify(a)).toBe(JSON.stringify(b))
  })

  it('differs only when the seed actually differs', () => {
    const a = generateLevelByDifficulty(SESSION_LIKE.difficulty, 1, 111111)
    const b = generateLevelByDifficulty(SESSION_LIKE.difficulty, 1, 222222)
    expect(JSON.stringify(a)).not.toBe(JSON.stringify(b))
  })
})