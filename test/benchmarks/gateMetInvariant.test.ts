import { describe, it, expect } from 'vitest'
import { generateLevel, targetDifficulty, DIFFICULTY_LEVEL } from '../../client/src/lib/levelGen/index'
import type { GeneratedLevel } from '../../client/src/lib/levelGen/types'

// Regression test for a real bug found during the 2026-08-24 puzzle-generation
// investigation (see project memory / generate.ts's Phase 3 comment): Phase 3
// ("fallback — accept any solvable puzzle regardless of target difficulty")
// used to hardcode `gateMet: true` on every candidate it returned, even though
// its own acceptance bar (difficultyScore >= 4) is far below hard/expert's real
// requirement. gateMet is exactly the flag the parallel coordinator
// (levelGenCoordinator.ts) uses to decide a worker found an outright win and
// cancel every other worker immediately — so this silently shipped trivial
// singleton+common-neighbor-only puzzles as "expert" roughly half the time
// (measured: 5/10 expert seeds in a spot sample), even when a sibling worker
// might have been about to land a genuine fork-anchored branch-rule/
// forcing-chain puzzle.
//
// The invariant every phase in generate.ts must uphold: gateMet: true implies
// the tier's real minStratBit requirement was satisfied — EXCEPT hard's
// legitimate phase-0.8 override, which accepts a genuine branch-rule/forcing-
// chain hit (bits 32|64) as an even-harder win even though hard's own
// minStratBit is naked/hidden-pair (bit 6) — see phase 0.8's own comment.
function gateMetIsHonest(levelNum: number, level: GeneratedLevel): boolean {
  if (!level.gateMet) return true
  const tgt = targetDifficulty(levelNum, level.size)
  if (tgt.minStratBit === 0) return true
  if ((level.strategiesUsed & tgt.minStratBit) !== 0) return true
  if (levelNum > 8 && (level.strategiesUsed & (32 | 64)) !== 0) return true // phase 0.8 override
  return false
}

describe('gateMet honesty invariant (regression for the Phase 3 fallback bug)', () => {
  it('expert: gateMet=true always implies a real hypothesis-based win (slow, several seeds including the confirmed bug-trigger seed)', () => {
    // seed 2 is a confirmed real-world trigger of the old bug (N=10, only
    // singleton+common-neighbor fired, old code still returned gateMet:true).
    for (const seed of [2, 4]) {
      const level = generateLevel(DIFFICULTY_LEVEL.expert, seed)
      expect(gateMetIsHonest(DIFFICULTY_LEVEL.expert, level),
        `seed=${seed} N=${level.size} strategies=0x${level.strategiesUsed.toString(16)} gateMet=${level.gateMet}`
      ).toBe(true)
    }
  }, 600000)

  it('hard: gateMet=true always implies a real naked/hidden-pair (or better) win', () => {
    for (let seed = 0; seed < 3; seed++) {
      const level = generateLevel(DIFFICULTY_LEVEL.hard, seed)
      expect(gateMetIsHonest(DIFFICULTY_LEVEL.hard, level),
        `seed=${seed} N=${level.size} strategies=0x${level.strategiesUsed.toString(16)} gateMet=${level.gateMet}`
      ).toBe(true)
    }
  }, 600000)
})
